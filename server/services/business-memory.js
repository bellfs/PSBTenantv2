const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../database');

const GENERATED_DIRS = ['raw', 'wiki', 'agents'];
const DEFAULT_LIMITS = {
  recentRows: 500,
  recentShortRows: 200,
  issueMessages: 12,
  issueFiles: 250
};

function memoryRoot() {
  if (process.env.BUSINESS_MEMORY_ROOT) return path.resolve(process.env.BUSINESS_MEMORY_ROOT);
  if (process.env.DATABASE_PATH) return path.join(path.dirname(path.resolve(process.env.DATABASE_PATH)), 'business-memory');
  return path.join(__dirname, '..', 'data', 'business-memory');
}

function ensureRoot() {
  const root = memoryRoot();
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  return root;
}

function safeRelativePath(relativePath) {
  const normalised = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalised || normalised.includes('\0')) throw new Error('Invalid file path');
  const parts = normalised.split('/');
  if (parts.some(part => part === '..')) throw new Error('Invalid file path');
  return normalised;
}

function resolveMemoryPath(relativePath) {
  const root = ensureRoot();
  const safe = safeRelativePath(relativePath);
  const target = path.resolve(root, safe);
  if (!target.startsWith(root + path.sep) && target !== root) throw new Error('Invalid file path');
  return { root, safe, target };
}

function cleanGeneratedDirs(root) {
  for (const dir of GENERATED_DIRS) {
    fs.rmSync(path.join(root, dir), { recursive: true, force: true });
  }
}

function writeFile(root, relativePath, content, writtenFiles) {
  const safe = safeRelativePath(relativePath);
  const target = path.join(root, safe);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  writtenFiles.push({ path: safe, bytes, updated_at: new Date().toISOString() });
  return bytes;
}

function writeFileIfMissing(root, relativePath, content, writtenFiles) {
  const safe = safeRelativePath(relativePath);
  const target = path.join(root, safe);
  if (fs.existsSync(target)) return 0;
  return writeFile(root, safe, content, writtenFiles);
}

function safeAll(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch { return []; }
}

function safeGet(db, sql, params = []) {
  try { return db.prepare(sql).get(...params); } catch { return null; }
}

function safeScalar(db, sql, params = [], fallback = 0) {
  const row = safeGet(db, sql, params);
  if (!row) return fallback;
  const value = Object.values(row)[0];
  return value == null ? fallback : value;
}

function collectTableCounts(db) {
  const tables = [
    'properties', 'tenants', 'tenancies', 'issues', 'messages', 'contractors', 'quotes',
    'compliance_certificates', 'documents', 'meter_readings', 'utility_rates',
    'bank_transactions', 'inspections', 'intake_items', 'intake_extractions',
    'email_agent_items', 'email_agent_drafts', 'email_agent_reports',
    'agent_tasks', 'agent_approvals', 'agent_events', 'agent_runs'
  ];
  return tables.map(table => ({ table, count: safeScalar(db, `SELECT COUNT(*) as count FROM ${table}`) }));
}

function collectData() {
  const db = getDb();
  try {
    const sourceCounts = collectTableCounts(db);
    const properties = safeAll(db, `
      SELECT p.*,
        COUNT(DISTINCT t.id) as tenant_count,
        COUNT(DISTINCT CASE WHEN i.status NOT IN ('resolved','closed') THEN i.id END) as open_issue_count,
        COUNT(DISTINCT i.id) as issue_count
      FROM properties p
      LEFT JOIN tenants t ON t.property_id = p.id
      LEFT JOIN issues i ON i.property_id = p.id
      GROUP BY p.id
      ORDER BY p.name COLLATE NOCASE
    `);
    const tenants = safeAll(db, `
      SELECT t.*, p.name as property_name, p.address as property_address
      FROM tenants t
      LEFT JOIN properties p ON p.id = t.property_id
      ORDER BY t.name COLLATE NOCASE
    `);
    const tenancies = safeAll(db, `
      SELECT ten.*, t.name as tenant_name, p.name as property_name
      FROM tenancies ten
      LEFT JOIN tenants t ON t.id = ten.tenant_id
      LEFT JOIN properties p ON p.id = ten.property_id
      ORDER BY COALESCE(ten.tenancy_end, ten.tenancy_start, ten.created_at) DESC
    `);
    const issues = safeAll(db, `
      SELECT i.*, t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone,
        p.name as property_name, p.address as property_address,
        (SELECT COUNT(*) FROM messages m WHERE m.issue_id = i.id) as message_count,
        (SELECT COUNT(*) FROM quotes q WHERE q.issue_id = i.id) as quote_count
      FROM issues i
      LEFT JOIN tenants t ON t.id = i.tenant_id
      LEFT JOIN properties p ON p.id = i.property_id
      ORDER BY CASE WHEN i.status IN ('resolved','closed') THEN 1 ELSE 0 END, i.updated_at DESC, i.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.issueFiles]);
    const messages = safeAll(db, `
      SELECT m.*, i.uuid as issue_uuid, i.title as issue_title
      FROM messages m
      LEFT JOIN issues i ON i.id = m.issue_id
      ORDER BY m.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const contractors = safeAll(db, `
      SELECT c.*,
        COUNT(q.id) as quote_count,
        SUM(CASE WHEN q.status IN ('approved','completed') THEN COALESCE(q.amount, 0) ELSE 0 END) as approved_value
      FROM contractors c
      LEFT JOIN quotes q ON q.contractor_id = c.id
      GROUP BY c.id
      ORDER BY c.active DESC, c.name COLLATE NOCASE
    `);
    const quotes = safeAll(db, `
      SELECT q.*, c.name as contractor_name, c.trade, i.uuid as issue_uuid, i.title as issue_title
      FROM quotes q
      LEFT JOIN contractors c ON c.id = q.contractor_id
      LEFT JOIN issues i ON i.id = q.issue_id
      ORDER BY q.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const certificates = safeAll(db, `
      SELECT cc.*, p.name as property_name
      FROM compliance_certificates cc
      LEFT JOIN properties p ON p.id = cc.property_id
      ORDER BY CASE WHEN cc.expiry_date IS NULL THEN 1 ELSE 0 END, cc.expiry_date ASC
    `);
    const documents = safeAll(db, `
      SELECT d.*, p.name as property_name, t.name as tenant_name
      FROM documents d
      LEFT JOIN properties p ON p.id = d.property_id
      LEFT JOIN tenants t ON t.id = d.tenant_id
      ORDER BY d.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const utilitySummary = safeAll(db, `
      SELECT COALESCE(p.name, mr.property_name, 'Unknown property') as property_name,
        mr.property_id, mr.meter_type,
        COUNT(*) as reading_count,
        SUM(COALESCE(mr.usage_kwh, 0)) as total_usage_kwh,
        SUM(COALESCE(mr.cost, 0)) as total_cost,
        MAX(printf('%04d-%02d', mr.year, mr.month)) as latest_period
      FROM meter_readings mr
      LEFT JOIN properties p ON p.id = mr.property_id
      GROUP BY mr.property_id, mr.property_name, mr.meter_type
      ORDER BY property_name COLLATE NOCASE, mr.meter_type
    `);
    const bankSummary = safeAll(db, `
      SELECT COALESCE(p.name, 'Unassigned') as property_name,
        COALESCE(bt.ai_category, bt.category, 'Uncategorised') as category,
        bt.direction,
        COUNT(*) as transaction_count,
        SUM(COALESCE(bt.amount, 0)) as total_amount
      FROM bank_transactions bt
      LEFT JOIN properties p ON p.id = bt.property_id
      GROUP BY property_name, category, bt.direction
      ORDER BY transaction_count DESC, ABS(total_amount) DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const bankTransactions = safeAll(db, `
      SELECT bt.*, ba.account_name, p.name as property_name, i.uuid as issue_uuid
      FROM bank_transactions bt
      LEFT JOIN bank_accounts ba ON ba.id = bt.bank_account_id
      LEFT JOIN properties p ON p.id = bt.property_id
      LEFT JOIN issues i ON i.id = bt.issue_id
      ORDER BY bt.date DESC, bt.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const inspections = safeAll(db, `
      SELECT ins.*, p.name as property_name, t.name as tenant_name
      FROM inspections ins
      LEFT JOIN properties p ON p.id = ins.property_id
      LEFT JOIN tenants t ON t.id = ins.tenant_id
      ORDER BY ins.inspection_date DESC, ins.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const intakeItems = safeAll(db, `
      SELECT i.*,
        (SELECT COUNT(*) FROM intake_extractions e WHERE e.intake_item_id = i.id) as extraction_count
      FROM intake_items i
      ORDER BY COALESCE(i.occurred_at, i.created_at) DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const intakeExtractions = safeAll(db, `
      SELECT e.*, i.sender, i.occurred_at, i.source_name
      FROM intake_extractions e
      LEFT JOIN intake_items i ON i.id = e.intake_item_id
      ORDER BY e.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const emailItems = safeAll(db, `
      SELECT eai.*, t.name as tenant_name, i.uuid as issue_uuid, i.title as issue_title
      FROM email_agent_items eai
      LEFT JOIN tenants t ON t.id = eai.matched_tenant_id
      LEFT JOIN issues i ON i.id = eai.issue_id
      ORDER BY eai.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const emailDrafts = safeAll(db, `
      SELECT d.*, eai.from_address, eai.from_name, eai.summary as item_summary
      FROM email_agent_drafts d
      LEFT JOIN email_agent_items eai ON eai.id = d.email_agent_item_id
      ORDER BY d.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentShortRows]);
    const emailReports = safeAll(db, `
      SELECT *
      FROM email_agent_reports
      ORDER BY report_date DESC
      LIMIT 60
    `);
    const agentTasks = safeAll(db, `
      SELECT t.*, p.name as property_name, ten.name as tenant_name, i.uuid as issue_uuid
      FROM agent_tasks t
      LEFT JOIN properties p ON p.id = t.property_id
      LEFT JOIN tenants ten ON ten.id = t.tenant_id
      LEFT JOIN issues i ON i.id = t.issue_id
      ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, t.updated_at DESC, t.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const agentApprovals = safeAll(db, `
      SELECT a.*, t.title as task_title
      FROM agent_approvals a
      LEFT JOIN agent_tasks t ON t.id = a.task_id
      ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentShortRows]);
    const agentEvents = safeAll(db, `
      SELECT ev.*, p.name as property_name, ten.name as tenant_name, i.uuid as issue_uuid
      FROM agent_events ev
      LEFT JOIN properties p ON p.id = ev.property_id
      LEFT JOIN tenants ten ON ten.id = ev.tenant_id
      LEFT JOIN issues i ON i.id = ev.issue_id
      ORDER BY ev.created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentRows]);
    const agentRuns = safeAll(db, `
      SELECT *
      FROM agent_runs
      ORDER BY created_at DESC
      LIMIT ?
    `, [DEFAULT_LIMITS.recentShortRows]);
    const latestSnapshot = safeGet(db, `
      SELECT *
      FROM business_memory_snapshots
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return {
      sourceCounts,
      properties,
      tenants,
      tenancies,
      issues,
      messages,
      contractors,
      quotes,
      certificates,
      documents,
      utilitySummary,
      bankSummary,
      bankTransactions,
      inspections,
      intakeItems,
      intakeExtractions,
      emailItems,
      emailDrafts,
      emailReports,
      agentTasks,
      agentApprovals,
      agentEvents,
      agentRuns,
      latestSnapshot
    };
  } finally {
    db.close();
  }
}

function value(value, fallback = '') {
  if (value == null || value === '') return fallback;
  return String(value);
}

function truncate(input, max = 420) {
  const text = value(input).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function mdEscape(input) {
  return value(input).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function money(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return '';
  return `GBP ${Number(amount).toFixed(2)}`;
}

function slugify(input, fallback = 'item') {
  const slug = value(input, fallback)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function fileHash(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);
}

function frontmatter(meta) {
  const body = Object.entries(meta)
    .map(([key, val]) => `${key}: ${JSON.stringify(val == null ? '' : val)}`)
    .join('\n');
  return `---\n${body}\n---\n\n`;
}

function section(title, body) {
  return `## ${title}\n\n${body || '_None recorded._'}\n`;
}

function table(rows, columns, empty = '_None recorded._') {
  if (!rows || rows.length === 0) return empty;
  const headers = columns.map(col => col.label);
  const lines = [
    `| ${headers.map(mdEscape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`
  ];
  for (const row of rows) {
    lines.push(`| ${columns.map(col => {
      const raw = typeof col.value === 'function' ? col.value(row) : row[col.value];
      return mdEscape(truncate(raw, col.max || 160));
    }).join(' | ')} |`);
  }
  return lines.join('\n');
}

function bulletList(rows, formatter, empty = '_None recorded._') {
  if (!rows || rows.length === 0) return empty;
  return rows.map(row => `- ${formatter(row)}`).join('\n');
}

function sourceCount(counts, tableName) {
  return counts.find(row => row.table === tableName)?.count || 0;
}

function issueFileName(issue) {
  return `${issue.id}-${slugify(issue.title || issue.uuid || 'issue')}.md`;
}

function propertyFileName(property) {
  return `${property.id}-${slugify(property.name || property.address || 'property')}.md`;
}

function tenantFileName(tenant) {
  return `${tenant.id}-${slugify(tenant.name || tenant.email || tenant.phone || 'tenant')}.md`;
}

function contractorFileName(contractor) {
  return `${contractor.id}-${slugify(contractor.name || 'contractor')}.md`;
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    const val = row[key] == null ? 'null' : String(row[key]);
    if (!acc[val]) acc[val] = [];
    acc[val].push(row);
    return acc;
  }, {});
}

function readJsonField(row, field) {
  if (!row?.[field]) return null;
  try { return JSON.parse(row[field]); } catch { return null; }
}

function buildRootReadme(generatedAt, root) {
  return `${frontmatter({
    title: 'FFR Business Memory',
    type: 'memory_root',
    generated_at: generatedAt,
    root
  })}# FFR Business Memory

This is the agent-readable memory filesystem for FFR Property OS.

The platform database and uploaded documents remain the source of truth. This folder is a compiled working memory for Codex agents and operators: Markdown for inspection, \`INDEX.json\` for lookup, and stable paths for workflows.

## Shape

- \`wiki/\` contains compiled operating knowledge by entity and lane.
- \`raw/\` contains source manifests, source counts and recent communication snippets.
- \`agents/\` contains agent run, task, approval and event memory.
- \`daily/\` contains dated business digests.
- \`notes/\` is reserved for human or Codex working notes and is not overwritten by snapshots.

## Snapshot Rule

Regenerate this memory after major email syncs, WhatsApp imports, finance imports, document uploads or agent runs. The generator overwrites compiled files but preserves \`notes/\`.
`;
}

function buildAgentsReadme(generatedAt) {
  return `${frontmatter({
    title: 'Codex Agent Memory Rules',
    type: 'agent_instructions',
    generated_at: generatedAt
  })}# Codex Agent Memory Rules

Use this filesystem as business context before acting inside FFR Property OS.

1. Start with \`wiki/index.md\` and \`INDEX.json\`.
2. Treat SQLite, connected inboxes and uploaded documents as canonical where there is a conflict.
3. Cite source ids, file paths, task ids, issue ids and email message ids in any recommendation.
4. Do not send messages, approve spend, alter rent/deposit positions or instruct contractors without a platform approval.
5. Store working notes in \`notes/\`; snapshots preserve that folder.
6. Prefer small, sourced updates to broad unsourced conclusions.

This follows the practical knowledge pattern from Karpathy's recent LLM wiki work: keep knowledge in files that humans and agents can read, diff, link and refresh.
`;
}

function buildSourceMap(data, generatedAt, root) {
  return `${frontmatter({
    title: 'Source Map',
    type: 'source_manifest',
    generated_at: generatedAt
  })}# Source Map

Root: \`${root}\`

${table(data.sourceCounts, [
    { label: 'Source table', value: 'table' },
    { label: 'Rows', value: 'count' }
  ])}

## Source Discipline

This memory layer does not replace source systems. It is an inspectable compiled layer over SQLite tables, inbox-derived agent records, WhatsApp exports, uploads and operating events.
`;
}

function buildWikiIndex(data, generatedAt, indexEntries) {
  const openIssues = data.issues.filter(issue => !['resolved', 'closed'].includes(value(issue.status).toLowerCase()));
  const urgentTasks = data.agentTasks.filter(task => task.status === 'open' && ['urgent', 'high'].includes(value(task.priority).toLowerCase()));
  const pendingApprovals = data.agentApprovals.filter(approval => approval.status === 'pending');
  const replyDrafts = data.emailDrafts.filter(draft => draft.status === 'draft');

  return `${frontmatter({
    title: 'Business Memory Index',
    type: 'wiki_index',
    generated_at: generatedAt
  })}# FFR Business Memory Index

## Operating Snapshot

${table([
    { label: 'Properties', value: data.properties.length },
    { label: 'Tenants', value: data.tenants.length },
    { label: 'Open issues', value: openIssues.length },
    { label: 'Open tasks', value: data.agentTasks.filter(task => task.status === 'open').length },
    { label: 'Pending approvals', value: pendingApprovals.length },
    { label: 'Email drafts', value: replyDrafts.length }
  ], [
    { label: 'Metric', value: 'label' },
    { label: 'Value', value: 'value' }
  ])}

## Priority Queues

${section('Urgent and High Tasks', bulletList(urgentTasks.slice(0, 20), task => `#${task.id} ${task.title} (${task.domain}, ${task.priority})`))}

${section('Pending Approvals', bulletList(pendingApprovals.slice(0, 20), approval => `#${approval.id} ${approval.title} (${approval.risk_level})`))}

${section('Open Issues', bulletList(openIssues.slice(0, 25), issue => `#${issue.id} ${issue.title} at ${issue.property_name || 'unknown property'} (${issue.status}, ${issue.priority})`))}

## Memory Files

${table(indexEntries.slice(0, 500), [
    { label: 'Type', value: 'type' },
    { label: 'Title', value: 'title' },
    { label: 'Path', value: 'path', max: 220 }
  ])}
`;
}

function buildPropertyPage(property, data, maps, generatedAt) {
  const tenants = data.tenants.filter(tenant => tenant.property_id === property.id);
  const tenancies = data.tenancies.filter(tenancy => tenancy.property_id === property.id);
  const issues = data.issues.filter(issue => issue.property_id === property.id);
  const certs = data.certificates.filter(cert => cert.property_id === property.id);
  const docs = data.documents.filter(doc => doc.property_id === property.id);
  const utilities = data.utilitySummary.filter(row => row.property_id === property.id);
  const inspections = data.inspections.filter(row => row.property_id === property.id);
  const tasks = data.agentTasks.filter(task => task.property_id === property.id);

  return `${frontmatter({
    title: property.name,
    type: 'property',
    property_id: property.id,
    generated_at: generatedAt
  })}# ${property.name}

${property.address || ''}${property.postcode ? `, ${property.postcode}` : ''}

## Snapshot

${table([
    { label: 'Units', value: property.num_units || '' },
    { label: 'Tenants', value: tenants.length },
    { label: 'Open issues', value: issues.filter(issue => !['resolved', 'closed'].includes(value(issue.status).toLowerCase())).length },
    { label: 'Documents', value: docs.length }
  ], [
    { label: 'Metric', value: 'label' },
    { label: 'Value', value: 'value' }
  ])}

${section('Tenants', table(tenants, [
    { label: 'Name', value: tenant => maps.tenantPath[tenant.id] ? `[${tenant.name}](../tenants/${maps.tenantPath[tenant.id].split('/').pop()})` : tenant.name },
    { label: 'Flat', value: 'flat_number' },
    { label: 'Email', value: 'email' },
    { label: 'Active', value: tenant => tenant.active === 0 ? 'No' : 'Yes' }
  ]))}

${section('Tenancies', table(tenancies.slice(0, 20), [
    { label: 'Tenant', value: 'tenant_name' },
    { label: 'Year', value: 'academic_year' },
    { label: 'Start', value: 'tenancy_start' },
    { label: 'End', value: 'tenancy_end' },
    { label: 'Weekly rent', value: row => money(row.rent_weekly) }
  ]))}

${section('Issues', table(issues.slice(0, 30), [
    { label: 'Issue', value: issue => maps.issuePath[issue.id] ? `[${issue.title}](../../operations/issues/${maps.issuePath[issue.id].split('/').pop()})` : issue.title, max: 220 },
    { label: 'Status', value: 'status' },
    { label: 'Priority', value: 'priority' },
    { label: 'Updated', value: 'updated_at' }
  ]))}

${section('Compliance', table(certs, [
    { label: 'Type', value: 'cert_type' },
    { label: 'Status', value: 'status' },
    { label: 'Expiry', value: 'expiry_date' },
    { label: 'Provider', value: 'provider' }
  ]))}

${section('Utilities', table(utilities, [
    { label: 'Meter', value: 'meter_type' },
    { label: 'Readings', value: 'reading_count' },
    { label: 'Usage kWh', value: row => Number(row.total_usage_kwh || 0).toFixed(1) },
    { label: 'Cost', value: row => money(row.total_cost) },
    { label: 'Latest', value: 'latest_period' }
  ]))}

${section('Tasks', table(tasks.slice(0, 20), [
    { label: 'Task', value: 'title' },
    { label: 'Domain', value: 'domain' },
    { label: 'Priority', value: 'priority' },
    { label: 'Status', value: 'status' }
  ]))}

${section('Documents', table(docs.slice(0, 20), [
    { label: 'Name', value: 'name' },
    { label: 'Category', value: 'category' },
    { label: 'Uploaded', value: 'created_at' }
  ]))}

${section('Inspections', table(inspections.slice(0, 20), [
    { label: 'Type', value: 'type' },
    { label: 'Flat', value: 'flat_number' },
    { label: 'Status', value: 'status' },
    { label: 'Date', value: 'inspection_date' }
  ]))}
`;
}

function buildTenantPage(tenant, data, maps, generatedAt) {
  const tenancies = data.tenancies.filter(row => row.tenant_id === tenant.id);
  const issues = data.issues.filter(issue => issue.tenant_id === tenant.id);
  const emailItems = data.emailItems.filter(item => item.matched_tenant_id === tenant.id);
  const tasks = data.agentTasks.filter(task => task.tenant_id === tenant.id);

  return `${frontmatter({
    title: tenant.name,
    type: 'tenant',
    tenant_id: tenant.id,
    property_id: tenant.property_id || '',
    generated_at: generatedAt
  })}# ${tenant.name}

## Contact

${table([
    { label: 'Property', value: tenant.property_name || '' },
    { label: 'Flat', value: tenant.flat_number || '' },
    { label: 'Email', value: tenant.email || '' },
    { label: 'Phone', value: tenant.phone || '' },
    { label: 'Active', value: tenant.active === 0 ? 'No' : 'Yes' }
  ], [
    { label: 'Field', value: 'label' },
    { label: 'Value', value: 'value' }
  ])}

${section('Tenancies', table(tenancies, [
    { label: 'Property', value: 'property_name' },
    { label: 'Year', value: 'academic_year' },
    { label: 'Start', value: 'tenancy_start' },
    { label: 'End', value: 'tenancy_end' },
    { label: 'Monthly rent', value: row => money(row.rent_monthly) }
  ]))}

${section('Issues', table(issues.slice(0, 30), [
    { label: 'Issue', value: issue => maps.issuePath[issue.id] ? `[${issue.title}](../../operations/issues/${maps.issuePath[issue.id].split('/').pop()})` : issue.title, max: 220 },
    { label: 'Status', value: 'status' },
    { label: 'Priority', value: 'priority' },
    { label: 'Created', value: 'created_at' }
  ]))}

${section('Email Context', table(emailItems.slice(0, 20), [
    { label: 'Subject', value: 'subject', max: 220 },
    { label: 'Priority', value: 'priority' },
    { label: 'Needs reply', value: row => row.needs_reply ? 'Yes' : 'No' },
    { label: 'Summary', value: 'summary', max: 320 }
  ]))}

${section('Tasks', table(tasks.slice(0, 20), [
    { label: 'Task', value: 'title' },
    { label: 'Domain', value: 'domain' },
    { label: 'Priority', value: 'priority' },
    { label: 'Status', value: 'status' }
  ]))}
`;
}

function buildContractorPage(contractor, data, generatedAt) {
  const quotes = data.quotes.filter(row => row.contractor_id === contractor.id);
  return `${frontmatter({
    title: contractor.name,
    type: 'contractor',
    contractor_id: contractor.id,
    generated_at: generatedAt
  })}# ${contractor.name}

## Profile

${table([
    { label: 'Trade', value: contractor.trade || '' },
    { label: 'Phone', value: contractor.phone || '' },
    { label: 'Email', value: contractor.email || '' },
    { label: 'Active', value: contractor.active ? 'Yes' : 'No' },
    { label: 'Approved value', value: money(contractor.approved_value) }
  ], [
    { label: 'Field', value: 'label' },
    { label: 'Value', value: 'value' }
  ])}

${section('Notes', contractor.notes || '_None recorded._')}

${section('Quotes', table(quotes.slice(0, 40), [
    { label: 'Issue', value: 'issue_title', max: 220 },
    { label: 'Description', value: 'description', max: 260 },
    { label: 'Amount', value: row => money(row.amount) },
    { label: 'Status', value: 'status' },
    { label: 'Created', value: 'created_at' }
  ]))}
`;
}

function buildIssuePage(issue, data, generatedAt) {
  const messages = data.messages.filter(message => message.issue_id === issue.id).slice(0, DEFAULT_LIMITS.issueMessages).reverse();
  const quotes = data.quotes.filter(row => row.issue_id === issue.id);
  const tasks = data.agentTasks.filter(task => task.issue_id === issue.id);
  const emails = data.emailItems.filter(item => item.issue_id === issue.id);

  return `${frontmatter({
    title: issue.title,
    type: 'issue',
    issue_id: issue.id,
    issue_uuid: issue.uuid,
    property_id: issue.property_id || '',
    tenant_id: issue.tenant_id || '',
    generated_at: generatedAt
  })}# ${issue.title}

## Snapshot

${table([
    { label: 'UUID', value: issue.uuid },
    { label: 'Property', value: issue.property_name || '' },
    { label: 'Tenant', value: issue.tenant_name || '' },
    { label: 'Flat', value: issue.flat_number || '' },
    { label: 'Category', value: issue.category || '' },
    { label: 'Status', value: issue.status || '' },
    { label: 'Priority', value: issue.priority || '' },
    { label: 'Estimated cost', value: money(issue.estimated_cost) },
    { label: 'Final cost', value: money(issue.final_cost) }
  ], [
    { label: 'Field', value: 'label' },
    { label: 'Value', value: 'value' }
  ])}

## Description

${issue.description || '_No description recorded._'}

${section('AI Diagnosis', issue.ai_diagnosis || issue.ai_report || '_No diagnosis recorded._')}

${section('Latest Messages', table(messages, [
    { label: 'When', value: 'created_at' },
    { label: 'Sender', value: 'sender' },
    { label: 'Message', value: row => truncate(row.content, 320), max: 360 }
  ]))}

${section('Quotes', table(quotes, [
    { label: 'Contractor', value: 'contractor_name' },
    { label: 'Trade', value: 'trade' },
    { label: 'Amount', value: row => money(row.amount) },
    { label: 'Status', value: 'status' }
  ]))}

${section('Email Context', table(emails, [
    { label: 'Subject', value: 'subject', max: 220 },
    { label: 'From', value: 'from_address' },
    { label: 'Summary', value: 'summary', max: 320 }
  ]))}

${section('Tasks', table(tasks, [
    { label: 'Task', value: 'title' },
    { label: 'Domain', value: 'domain' },
    { label: 'Priority', value: 'priority' },
    { label: 'Status', value: 'status' }
  ]))}
`;
}

function buildTasksPage(data, generatedAt) {
  return `${frontmatter({
    title: 'Tasks',
    type: 'operations_tasks',
    generated_at: generatedAt
  })}# Agent Tasks

${table(data.agentTasks, [
    { label: 'ID', value: 'id' },
    { label: 'Task', value: 'title', max: 260 },
    { label: 'Domain', value: 'domain' },
    { label: 'Priority', value: 'priority' },
    { label: 'Status', value: 'status' },
    { label: 'Owner', value: 'assigned_to' },
    { label: 'Property', value: 'property_name' },
    { label: 'Due', value: 'due_date' }
  ])}
`;
}

function buildApprovalsPage(data, generatedAt) {
  return `${frontmatter({
    title: 'Approvals',
    type: 'operations_approvals',
    generated_at: generatedAt
  })}# Approvals

${table(data.agentApprovals, [
    { label: 'ID', value: 'id' },
    { label: 'Title', value: 'title', max: 260 },
    { label: 'Action', value: 'action_type' },
    { label: 'Risk', value: 'risk_level' },
    { label: 'Status', value: 'status' },
    { label: 'Task', value: 'task_title', max: 220 },
    { label: 'Created', value: 'created_at' }
  ])}
`;
}

function buildCompliancePage(data, generatedAt) {
  return `${frontmatter({
    title: 'Compliance',
    type: 'operations_compliance',
    generated_at: generatedAt
  })}# Compliance Memory

${table(data.certificates, [
    { label: 'Property', value: 'property_name' },
    { label: 'Type', value: 'cert_type' },
    { label: 'Status', value: 'status' },
    { label: 'Expiry', value: 'expiry_date' },
    { label: 'Provider', value: 'provider' },
    { label: 'Notes', value: 'notes', max: 260 }
  ])}

## Documents

${table(data.documents, [
    { label: 'Name', value: 'name', max: 260 },
    { label: 'Category', value: 'category' },
    { label: 'Property', value: 'property_name' },
    { label: 'Tenant', value: 'tenant_name' },
    { label: 'Uploaded', value: 'created_at' }
  ])}
`;
}

function buildUtilitiesPage(data, generatedAt) {
  return `${frontmatter({
    title: 'Utilities',
    type: 'operations_utilities',
    generated_at: generatedAt
  })}# Utilities Memory

${table(data.utilitySummary, [
    { label: 'Property', value: 'property_name' },
    { label: 'Meter', value: 'meter_type' },
    { label: 'Readings', value: 'reading_count' },
    { label: 'Usage kWh', value: row => Number(row.total_usage_kwh || 0).toFixed(1) },
    { label: 'Cost', value: row => money(row.total_cost) },
    { label: 'Latest', value: 'latest_period' }
  ])}
`;
}

function buildFinancePage(data, generatedAt) {
  return `${frontmatter({
    title: 'Finance',
    type: 'operations_finance',
    generated_at: generatedAt
  })}# Finance Memory

## Category Summary

${table(data.bankSummary, [
    { label: 'Property', value: 'property_name' },
    { label: 'Category', value: 'category' },
    { label: 'Direction', value: 'direction' },
    { label: 'Transactions', value: 'transaction_count' },
    { label: 'Amount', value: row => money(row.total_amount) }
  ])}

## Recent Transactions

${table(data.bankTransactions.slice(0, 120), [
    { label: 'Date', value: 'date' },
    { label: 'Account', value: 'account_name' },
    { label: 'Counterparty', value: 'counterparty', max: 180 },
    { label: 'Amount', value: row => `${row.direction === 'OUT' ? '-' : ''}${money(row.amount)}` },
    { label: 'Category', value: row => row.ai_category || row.category || '' },
    { label: 'Property', value: 'property_name' }
  ])}
`;
}

function buildEmailPage(data, generatedAt) {
  return `${frontmatter({
    title: 'Email Memory',
    type: 'comms_email',
    generated_at: generatedAt
  })}# Email Memory

## Recent Email Agent Items

${table(data.emailItems, [
    { label: 'Created', value: 'created_at' },
    { label: 'From', value: row => row.from_name ? `${row.from_name} <${row.from_address}>` : row.from_address, max: 220 },
    { label: 'Subject', value: 'subject', max: 240 },
    { label: 'Domain', value: 'domain' },
    { label: 'Priority', value: 'priority' },
    { label: 'Needs reply', value: row => row.needs_reply ? 'Yes' : 'No' },
    { label: 'Summary', value: 'summary', max: 320 }
  ])}

## Drafts

${table(data.emailDrafts, [
    { label: 'Created', value: 'created_at' },
    { label: 'To', value: 'to_address' },
    { label: 'Subject', value: 'subject', max: 240 },
    { label: 'Status', value: 'status' },
    { label: 'Gmail draft', value: row => row.gmail_draft_id ? 'Created' : '' },
    { label: 'Preview', value: row => truncate(row.body_text, 260), max: 300 }
  ])}

## Reports

${table(data.emailReports, [
    { label: 'Date', value: 'report_date' },
    { label: 'Subject', value: 'subject' },
    { label: 'Status', value: 'status' },
    { label: 'Sent', value: 'sent_at' }
  ])}
`;
}

function buildWhatsAppPage(data, generatedAt) {
  return `${frontmatter({
    title: 'WhatsApp Memory',
    type: 'comms_whatsapp',
    generated_at: generatedAt
  })}# WhatsApp and Intake Memory

## Recent Intake Items

${table(data.intakeItems, [
    { label: 'When', value: row => row.occurred_at || row.created_at },
    { label: 'Source', value: row => `${row.source_type}${row.source_name ? `:${row.source_name}` : ''}`, max: 220 },
    { label: 'Sender', value: 'sender' },
    { label: 'Extractions', value: 'extraction_count' },
    { label: 'Snippet', value: row => truncate(row.content, 320), max: 360 }
  ])}

## Extractions

${table(data.intakeExtractions, [
    { label: 'Created', value: 'created_at' },
    { label: 'Title', value: 'title', max: 260 },
    { label: 'Type', value: 'extraction_type' },
    { label: 'Domain', value: 'domain' },
    { label: 'Priority', value: 'priority' },
    { label: 'Agent', value: 'agent_key' },
    { label: 'Summary', value: 'summary', max: 320 }
  ])}

## Tenant-Facing Issue Messages

${table(data.messages.slice(0, 120), [
    { label: 'When', value: 'created_at' },
    { label: 'Issue', value: 'issue_title', max: 220 },
    { label: 'Sender', value: 'sender' },
    { label: 'Message', value: row => truncate(row.content, 320), max: 360 }
  ])}
`;
}

function buildAgentRunsPage(data, generatedAt) {
  return `${frontmatter({
    title: 'Agent Runs',
    type: 'agent_runs',
    generated_at: generatedAt
  })}# Agent Runs

${table(data.agentRuns, [
    { label: 'ID', value: 'id' },
    { label: 'Agent', value: 'agent_name' },
    { label: 'Key', value: 'agent_key' },
    { label: 'Mode', value: 'mode' },
    { label: 'Status', value: 'status' },
    { label: 'Trigger', value: 'trigger_type' },
    { label: 'Created', value: 'created_at' },
    { label: 'Output', value: row => truncate(row.output_text || row.error, 280), max: 320 }
  ])}
`;
}

function buildAgentEventsPage(data, generatedAt) {
  return `${frontmatter({
    title: 'Agent Events',
    type: 'agent_events',
    generated_at: generatedAt
  })}# Agent Events

${table(data.agentEvents, [
    { label: 'Created', value: 'created_at' },
    { label: 'Type', value: 'event_type' },
    { label: 'Domain', value: 'domain' },
    { label: 'Source', value: row => `${row.source}${row.source_ref ? `:${row.source_ref}` : ''}` },
    { label: 'Actor', value: 'actor' },
    { label: 'Property', value: 'property_name' },
    { label: 'Issue', value: 'issue_uuid' },
    { label: 'Payload', value: row => truncate(JSON.stringify(readJsonField(row, 'payload_json') || {}), 260), max: 300 }
  ])}
`;
}

function buildDailyDigest(data, generatedAt) {
  const today = generatedAt.slice(0, 10);
  const todayPrefix = today;
  const todayTasks = data.agentTasks.filter(task => value(task.created_at).startsWith(todayPrefix) || value(task.updated_at).startsWith(todayPrefix));
  const todayIntake = data.intakeItems.filter(item => value(item.created_at).startsWith(todayPrefix) || value(item.occurred_at).startsWith(todayPrefix));
  const todayEmail = data.emailItems.filter(item => value(item.created_at).startsWith(todayPrefix));
  const todayEvents = data.agentEvents.filter(event => value(event.created_at).startsWith(todayPrefix));
  const openTasks = data.agentTasks.filter(task => task.status === 'open');
  const pendingApprovals = data.agentApprovals.filter(approval => approval.status === 'pending');

  return `${frontmatter({
    title: `Daily Digest ${today}`,
    type: 'daily_digest',
    date: today,
    generated_at: generatedAt
  })}# Daily Digest: ${today}

## Counts

${table([
    { label: 'New or updated tasks', value: todayTasks.length },
    { label: 'Intake items', value: todayIntake.length },
    { label: 'Email items', value: todayEmail.length },
    { label: 'Agent events', value: todayEvents.length },
    { label: 'Open tasks total', value: openTasks.length },
    { label: 'Pending approvals total', value: pendingApprovals.length }
  ], [
    { label: 'Metric', value: 'label' },
    { label: 'Value', value: 'value' }
  ])}

${section('New or Updated Tasks', table(todayTasks.slice(0, 30), [
    { label: 'Task', value: 'title', max: 260 },
    { label: 'Domain', value: 'domain' },
    { label: 'Priority', value: 'priority' },
    { label: 'Status', value: 'status' }
  ]))}

${section('Email', table(todayEmail.slice(0, 30), [
    { label: 'Subject', value: 'subject', max: 240 },
    { label: 'From', value: 'from_address' },
    { label: 'Needs reply', value: row => row.needs_reply ? 'Yes' : 'No' },
    { label: 'Summary', value: 'summary', max: 320 }
  ]))}

${section('Intake', table(todayIntake.slice(0, 30), [
    { label: 'Source', value: 'source_name' },
    { label: 'Sender', value: 'sender' },
    { label: 'Snippet', value: row => truncate(row.content, 320), max: 360 }
  ]))}
`;
}

function buildIndexJson(data, generatedAt, root, entries, files) {
  return JSON.stringify({
    title: 'FFR Business Memory',
    generated_at: generatedAt,
    root,
    counts: Object.fromEntries(data.sourceCounts.map(row => [row.table, row.count])),
    latest_snapshot: data.latestSnapshot || null,
    entries,
    files: files.map(file => ({ path: file.path, bytes: file.bytes, updated_at: file.updated_at }))
  }, null, 2);
}

function recordSnapshot(result) {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO business_memory_snapshots (root_path, file_count, bytes_written, status, error, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      result.root_path,
      result.file_count || 0,
      result.bytes_written || 0,
      result.status || 'completed',
      result.error || null,
      result.created_by || null
    );
  } catch {
    // Snapshot logging should not make memory generation fail.
  } finally {
    db.close();
  }
}

function snapshotBusinessMemory(options = {}) {
  const generatedAt = new Date().toISOString();
  const root = ensureRoot();
  const writtenFiles = [];
  const indexEntries = [];
  let bytesWritten = 0;

  try {
    cleanGeneratedDirs(root);
    const data = collectData();
    const maps = {
      propertyPath: {},
      tenantPath: {},
      issuePath: {},
      contractorPath: {}
    };

    bytesWritten += writeFile(root, 'README.md', buildRootReadme(generatedAt, root), writtenFiles);
    bytesWritten += writeFile(root, 'AGENTS.md', buildAgentsReadme(generatedAt), writtenFiles);
    bytesWritten += writeFileIfMissing(root, 'notes/README.md', `${frontmatter({ title: 'Notes', type: 'working_notes', generated_at: generatedAt })}# Notes\n\nHuman and Codex working notes live here. Business Memory snapshots preserve this folder.\n`, writtenFiles);

    bytesWritten += writeFile(root, 'raw/source-map.md', buildSourceMap(data, generatedAt, root), writtenFiles);
    bytesWritten += writeFile(root, 'raw/recent-email.md', buildEmailPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'raw/recent-whatsapp.md', buildWhatsAppPage(data, generatedAt), writtenFiles);

    for (const property of data.properties) {
      maps.propertyPath[property.id] = `wiki/entities/properties/${propertyFileName(property)}`;
      indexEntries.push({ type: 'property', id: property.id, title: property.name, path: maps.propertyPath[property.id] });
    }
    for (const tenant of data.tenants) {
      maps.tenantPath[tenant.id] = `wiki/entities/tenants/${tenantFileName(tenant)}`;
      indexEntries.push({ type: 'tenant', id: tenant.id, title: tenant.name, path: maps.tenantPath[tenant.id] });
    }
    for (const issue of data.issues) {
      maps.issuePath[issue.id] = `wiki/operations/issues/${issueFileName(issue)}`;
      indexEntries.push({ type: 'issue', id: issue.id, uuid: issue.uuid, title: issue.title, path: maps.issuePath[issue.id] });
    }
    for (const contractor of data.contractors) {
      maps.contractorPath[contractor.id] = `wiki/entities/contractors/${contractorFileName(contractor)}`;
      indexEntries.push({ type: 'contractor', id: contractor.id, title: contractor.name, path: maps.contractorPath[contractor.id] });
    }

    bytesWritten += writeFile(root, 'wiki/index.md', buildWikiIndex(data, generatedAt, indexEntries), writtenFiles);

    for (const property of data.properties) {
      bytesWritten += writeFile(root, maps.propertyPath[property.id], buildPropertyPage(property, data, maps, generatedAt), writtenFiles);
    }
    for (const tenant of data.tenants) {
      bytesWritten += writeFile(root, maps.tenantPath[tenant.id], buildTenantPage(tenant, data, maps, generatedAt), writtenFiles);
    }
    for (const contractor of data.contractors) {
      bytesWritten += writeFile(root, maps.contractorPath[contractor.id], buildContractorPage(contractor, data, generatedAt), writtenFiles);
    }
    for (const issue of data.issues) {
      bytesWritten += writeFile(root, maps.issuePath[issue.id], buildIssuePage(issue, data, generatedAt), writtenFiles);
    }

    bytesWritten += writeFile(root, 'wiki/operations/tasks.md', buildTasksPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'wiki/operations/approvals.md', buildApprovalsPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'wiki/operations/compliance.md', buildCompliancePage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'wiki/operations/utilities.md', buildUtilitiesPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'wiki/operations/finance.md', buildFinancePage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'wiki/comms/email.md', buildEmailPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'wiki/comms/whatsapp.md', buildWhatsAppPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'agents/tasks.md', buildTasksPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'agents/approvals.md', buildApprovalsPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'agents/runs.md', buildAgentRunsPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, 'agents/events.md', buildAgentEventsPage(data, generatedAt), writtenFiles);
    bytesWritten += writeFile(root, `daily/${generatedAt.slice(0, 10)}.md`, buildDailyDigest(data, generatedAt), writtenFiles);

    const indexJson = buildIndexJson(data, generatedAt, root, indexEntries, writtenFiles);
    bytesWritten += writeFile(root, 'INDEX.json', indexJson, writtenFiles);

    const result = {
      status: 'completed',
      root_path: root,
      generated_at: generatedAt,
      file_count: writtenFiles.length,
      bytes_written: bytesWritten,
      index_hash: fileHash(indexJson),
      created_by: options.createdBy || null,
      files: writtenFiles
    };
    recordSnapshot(result);
    return result;
  } catch (error) {
    const result = {
      status: 'failed',
      root_path: root,
      generated_at: generatedAt,
      file_count: writtenFiles.length,
      bytes_written: bytesWritten,
      error: error.message,
      created_by: options.createdBy || null
    };
    recordSnapshot(result);
    throw error;
  }
}

function walkFiles(dir, root, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === '.DS_Store') continue;
    if (entry.isDirectory()) {
      walkFiles(fullPath, root, output);
    } else {
      const stat = fs.statSync(fullPath);
      output.push({
        path: path.relative(root, fullPath).replace(/\\/g, '/'),
        size: stat.size,
        updated_at: stat.mtime.toISOString(),
        type: path.extname(entry.name).replace('.', '') || 'file'
      });
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

function getMemorySummary() {
  const root = ensureRoot();
  const db = getDb();
  try {
    const files = walkFiles(root, root);
    const latestSnapshot = safeGet(db, `
      SELECT *
      FROM business_memory_snapshots
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const sourceCounts = collectTableCounts(db);
    return {
      root_path: root,
      exists: fs.existsSync(root),
      file_count: files.length,
      bytes: files.reduce((total, file) => total + file.size, 0),
      latest_snapshot: latestSnapshot,
      source_counts: sourceCounts,
      open_tasks: safeScalar(db, "SELECT COUNT(*) as count FROM agent_tasks WHERE status = 'open'"),
      email_items: sourceCount(sourceCounts, 'email_agent_items'),
      intake_items: sourceCount(sourceCounts, 'intake_items')
    };
  } finally {
    db.close();
  }
}

function listMemoryFiles() {
  const root = ensureRoot();
  return walkFiles(root, root);
}

function readMemoryFile(relativePath) {
  const { safe, target } = resolveMemoryPath(relativePath);
  if (!fs.existsSync(target)) throw new Error('Business Memory file not found');
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error('Business Memory path is not a file');
  return {
    path: safe,
    size: stat.size,
    updated_at: stat.mtime.toISOString(),
    content: fs.readFileSync(target, 'utf8')
  };
}

module.exports = {
  memoryRoot,
  ensureRoot,
  snapshotBusinessMemory,
  getMemorySummary,
  listMemoryFiles,
  readMemoryFile
};
