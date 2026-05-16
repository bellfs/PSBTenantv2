const { getDb } = require('../database');
const { sendGenericEmail } = require('./email');

let google = null;
try {
  google = require('googleapis').google;
} catch (error) {
  console.log('[EmailAgent] googleapis not installed - Gmail draft creation disabled');
}

const DEFAULT_TEAM_RECIPIENTS = [
  'andy@52oldelvet.com',
  'akiel@52oldelvet.com',
  'hannah@52oldelvet.com',
  'fergus@fiftytwo-group.com'
];

const SHORT_LET_CHANNELS = [
  'airbnb',
  'booking.com',
  'expedia',
  'hotels.com',
  'vrbo',
  'guesty',
  'hostaway',
  'smoobu'
];

const PROPERTY_HINTS = [
  { name: '52 Old Elvet', aliases: ['52 old elvet', 'old elvet', 'psb52', 'the villiers', 'the barrington', 'the egerton', 'the wolsey', 'the tunstall', 'the montague', 'the morton', 'the gray', 'the langley', 'the kirkham', 'the fordham', 'talbot penthouse'] },
  { name: '2 St Margarets Mews', aliases: ['2 st margarets', 'st margarets mews', 'st margaret', 'margarets'] },
  { name: '35 St Andrews Court', aliases: ['35 st andrews', 'st andrews court', 'st andrews'] },
  { name: '7 Cathedrals', aliases: ['7 cathedrals', 'cathedrals'] },
  { name: '24 Hallgarth Street', aliases: ['24 hallgarth', 'hallgarth street', 'hallgarth'] }
];

function getTeamRecipients() {
  return (process.env.EMAIL_AGENT_TEAM_RECIPIENTS || DEFAULT_TEAM_RECIPIENTS.join(','))
    .split(',')
    .map(email => email.trim())
    .filter(Boolean);
}

function getManagedInbox() {
  return (process.env.EMAIL_AGENT_INBOX || 'admin@52oldelvet.com').toLowerCase();
}

function isManagedInboxAccount(account) {
  return account?.email_address?.toLowerCase() === getManagedInbox();
}

function getGmailOAuth2Client() {
  if (!google) throw new Error('googleapis package not installed');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://maintenance.52oldelvet.com/api/email/accounts/gmail/callback';
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function sanitizeHeader(value = '') {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeRawEmail(raw) {
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createGmailDraft(account, { to, subject, bodyText, threadId }) {
  if (!account || account.provider !== 'gmail') return null;
  const oauth2Client = getGmailOAuth2Client();
  const tokens = JSON.parse(account.credentials || '{}');
  oauth2Client.setCredentials(tokens);

  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const nextCredentials = { ...tokens, ...credentials, refresh_token: credentials.refresh_token || tokens.refresh_token };
    oauth2Client.setCredentials(nextCredentials);
    const db = getDb();
    try {
      db.prepare('UPDATE email_accounts SET credentials = ? WHERE id = ?').run(JSON.stringify(nextCredentials), account.id);
    } finally {
      db.close();
    }
  }

  const raw = [
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyText || ''
  ].join('\r\n');

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const requestBody = { message: { raw: encodeRawEmail(raw) } };
  if (threadId) requestBody.message.threadId = threadId;
  const response = await gmail.users.drafts.create({ userId: 'me', requestBody });
  return response.data;
}

function todayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.EMAIL_AGENT_TIMEZONE || 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getLocalTimeParts(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.EMAIL_AGENT_TIMEZONE || 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = Number(part.value);
    return acc;
  }, {});
}

function truncate(value = '', max = 1200) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function htmlEscape(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBriefDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.EMAIL_AGENT_TIMEZONE || 'Europe/London',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function htmlList(rows, formatter, empty = '<li>No items.</li>') {
  if (!rows || rows.length === 0) return empty;
  return rows.map(row => `<li>${formatter(row)}</li>`).join('');
}

function firstName(nameOrEmail = '') {
  const value = String(nameOrEmail || '').trim();
  if (!value) return '';
  if (value.includes('@')) return '';
  return value.split(/\s+/)[0].replace(/[^a-z'-]/gi, '');
}

function isNoReplyAddress(email = '') {
  return /(^|[._-])(no-?reply|donotreply|noreply|notifications?|alerts?)([._-]|@)/i.test(email);
}

function isLikelyAutomatedEmail(fromEmail = '', subject = '', body = '') {
  const from = String(fromEmail || '').toLowerCase();
  const text = `${subject}\n${body}`.toLowerCase();
  return isNoReplyAddress(from) ||
    /(mailer-daemon|postmaster|calendar-notification|drive-shares|notifications?@|alerts?@)/i.test(from) ||
    /(newsletter|unsubscribe|do not reply|automated message|security alert|delivery status notification)/i.test(text);
}

function detectCommercialContext({ subject = '', body = '', fromEmail = '', fromName = '' }) {
  const from = `${fromEmail} ${fromName}`.toLowerCase();
  const text = `${subject}\n${body}`.toLowerCase();
  const haystack = `${from}\n${text}`;
  const channel = SHORT_LET_CHANNELS.find(name => haystack.includes(name));
  const propertyHints = PROPERTY_HINTS
    .filter(property => property.aliases.some(alias => haystack.includes(alias)))
    .map(property => property.name);
  const shortLetAction = /(guest message|guest request|alteration request|cancell?ation|cancelled|complaint|damage|refund|chargeback|payment failed|booking request|reservation request|check[- ]?in today|check[- ]?out today|review|missing key|late arrival|cleaning issue)/i.test(haystack);
  const bookingReference = haystack.match(/\b([A-Z0-9]{6,}[-_]?[A-Z0-9]{2,})\b/i)?.[1] || null;

  return {
    channel: channel || null,
    property_hints: propertyHints,
    booking_reference: bookingReference,
    short_let_action: shortLetAction,
    is_short_let: !!channel || /(short[- ]?let|guest|reservation|check[- ]?in|check[- ]?out|cleaner|linen)/i.test(haystack)
  };
}

function buildNameSearchTerms(fromName = '', tenant = null) {
  const terms = new Set();
  for (const value of [fromName, tenant?.name]) {
    String(value || '').split(/\s+/).forEach(part => {
      const clean = part.replace(/[^a-z0-9'-]/gi, '').trim();
      if (clean.length >= 3) terms.add(clean);
    });
  }
  if (tenant?.email) terms.add(tenant.email);
  return Array.from(terms).slice(0, 4);
}

function queryAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    return [];
  }
}

function buildBusinessMemory(db, { messageId, fromEmail, fromName, tenant, issue, classification }) {
  const tenantId = tenant?.id || null;
  const propertyId = tenant?.property_id || issue?.property_id || null;
  const issueId = issue?.id || null;
  const nameTerms = buildNameSearchTerms(fromName, tenant);
  const nameClauses = nameTerms.map(() => '(LOWER(i.sender) LIKE ? OR LOWER(i.content) LIKE ?)').join(' OR ');
  const nameParams = nameTerms.flatMap(term => [`%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`]);

  const previousEmails = queryAll(db, `
    SELECT subject, summary, domain, priority, status, created_at
    FROM email_agent_items
    WHERE message_id != ? AND LOWER(COALESCE(from_address, '')) = LOWER(?)
    ORDER BY created_at DESC
    LIMIT 8
  `, [messageId, fromEmail || '']);

  const previousEmailLogs = queryAll(db, `
    SELECT from_address, subject, matched_tenant_id, issue_id, status, processed_at
    FROM email_sync_log
    WHERE message_id != ?
      AND (
        LOWER(COALESCE(from_address, '')) = LOWER(?)
        OR (? IS NOT NULL AND matched_tenant_id = ?)
        OR (? IS NOT NULL AND issue_id = ?)
      )
    ORDER BY processed_at DESC
    LIMIT 12
  `, [messageId, fromEmail || '', tenantId, tenantId, issueId, issueId]);

  const tenantEmails = tenantId ? queryAll(db, `
    SELECT subject, summary, domain, priority, status, created_at
    FROM email_agent_items
    WHERE message_id != ? AND matched_tenant_id = ?
    ORDER BY created_at DESC
    LIMIT 8
  `, [messageId, tenantId]) : [];

  const domainEmails = queryAll(db, `
    SELECT subject, summary, domain, priority, status, created_at
    FROM email_agent_items
    WHERE message_id != ? AND domain = ?
    ORDER BY created_at DESC
    LIMIT 5
  `, [messageId, classification.domain]);

  const relatedIssues = queryAll(db, `
    SELECT i.id, i.uuid, i.title, i.status, i.priority, i.category, i.created_at, i.updated_at, p.name as property_name
    FROM issues i
    LEFT JOIN properties p ON p.id = i.property_id
    WHERE (? IS NOT NULL AND i.tenant_id = ?)
       OR (? IS NOT NULL AND i.property_id = ?)
       OR (? IS NOT NULL AND i.id = ?)
    ORDER BY CASE i.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'escalated' THEN 3 ELSE 4 END, i.updated_at DESC
    LIMIT 8
  `, [tenantId, tenantId, propertyId, propertyId, issueId, issueId]);

  const whatsappIssueMessages = queryAll(db, `
    SELECT m.sender, m.content, m.message_type, m.created_at, i.uuid as issue_uuid, i.title as issue_title
    FROM messages m
    JOIN issues i ON i.id = m.issue_id
    WHERE (? IS NOT NULL AND i.id = ?)
       OR (? IS NOT NULL AND i.tenant_id = ?)
       OR (? IS NOT NULL AND i.property_id = ?)
    ORDER BY m.created_at DESC
    LIMIT 12
  `, [issueId, issueId, tenantId, tenantId, propertyId, propertyId]);

  const whatsappIntakeByPerson = nameClauses ? queryAll(db, `
    SELECT i.sender, i.content, i.occurred_at, i.source_name
    FROM intake_items i
    WHERE i.source_type LIKE 'whatsapp%' AND (${nameClauses})
    ORDER BY COALESCE(i.occurred_at, i.created_at) DESC
    LIMIT 10
  `, nameParams) : [];

  const whatsappIntakeByDomain = queryAll(db, `
    SELECT i.sender, i.content, i.occurred_at, e.title, e.summary, e.domain, e.priority
    FROM intake_extractions e
    JOIN intake_items i ON i.id = e.intake_item_id
    WHERE i.source_type LIKE 'whatsapp%' AND e.domain = ?
    ORDER BY e.created_at DESC
    LIMIT 8
  `, [classification.domain]);

  const openTasks = queryAll(db, `
    SELECT title, description, domain, priority, assigned_to, due_date, created_at
    FROM agent_tasks
    WHERE status = 'open'
      AND (
        domain = ?
        OR (? IS NOT NULL AND tenant_id = ?)
        OR (? IS NOT NULL AND issue_id = ?)
      )
    ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at DESC
    LIMIT 8
  `, [classification.domain, tenantId, tenantId, issueId, issueId]);

  return {
    previousEmails,
    previousEmailLogs,
    tenantEmails,
    domainEmails,
    relatedIssues,
    whatsappIssueMessages,
    whatsappIntakeByPerson,
    whatsappIntakeByDomain,
    openTasks
  };
}

function summariseBusinessMemory(memory) {
  const safeMemory = {
    previousEmails: [],
    previousEmailLogs: [],
    tenantEmails: [],
    domainEmails: [],
    relatedIssues: [],
    whatsappIssueMessages: [],
    whatsappIntakeByPerson: [],
    whatsappIntakeByDomain: [],
    openTasks: [],
    ...(memory || {})
  };
  return {
    previous_email_count: safeMemory.previousEmails.length,
    previous_email_log_count: safeMemory.previousEmailLogs.length,
    tenant_email_count: safeMemory.tenantEmails.length,
    domain_email_count: safeMemory.domainEmails.length,
    related_issue_count: safeMemory.relatedIssues.length,
    whatsapp_issue_message_count: safeMemory.whatsappIssueMessages.length,
    whatsapp_intake_person_count: safeMemory.whatsappIntakeByPerson.length,
    whatsapp_intake_domain_count: safeMemory.whatsappIntakeByDomain.length,
    open_task_count: safeMemory.openTasks.length,
    latest_previous_email_subjects: [
      ...safeMemory.previousEmails.slice(0, 3).map(item => item.subject).filter(Boolean),
      ...safeMemory.previousEmailLogs.slice(0, 3).map(item => item.subject).filter(Boolean)
    ].filter((subject, index, values) => subject && values.indexOf(subject) === index).slice(0, 5),
    latest_related_issues: safeMemory.relatedIssues.slice(0, 3).map(item => ({
      uuid: item.uuid,
      title: item.title,
      status: item.status,
      priority: item.priority
    })),
    latest_open_tasks: safeMemory.openTasks.slice(0, 3).map(item => ({
      title: item.title,
      priority: item.priority,
      assigned_to: item.assigned_to
    }))
  };
}

function formatInternalMemoryBrief(memory) {
  const summary = summariseBusinessMemory(memory);
  const lines = [];
  if (summary.latest_related_issues.length) {
    lines.push(`Related issues: ${summary.latest_related_issues.map(issue => `${issue.uuid || 'issue'} ${issue.title} (${issue.status})`).join('; ')}`);
  }
  if (summary.latest_previous_email_subjects.length) {
    lines.push(`Previous emails: ${summary.latest_previous_email_subjects.join('; ')}`);
  }
  if (summary.latest_open_tasks.length) {
    lines.push(`Open tasks: ${summary.latest_open_tasks.map(task => `${task.title}${task.assigned_to ? ` -> ${task.assigned_to}` : ''}`).join('; ')}`);
  }
  if (summary.whatsapp_issue_message_count || summary.whatsapp_intake_person_count || summary.whatsapp_intake_domain_count) {
    lines.push(`WhatsApp context: ${summary.whatsapp_issue_message_count + summary.whatsapp_intake_person_count + summary.whatsapp_intake_domain_count} relevant stored WhatsApp/context items considered.`);
  }
  return lines.join('\n');
}

function parseJsonObject(value) {
  if (!value) return null;
  try {
    const cleaned = String(value).trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) return JSON.parse(cleaned.slice(start, end + 1));
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function boolFlag(value) {
  if (value === true || value === 1 || value === '1') return 1;
  if (typeof value === 'string') return ['true', 'yes', 'y'].includes(value.toLowerCase()) ? 1 : 0;
  return 0;
}

function clampChoice(value, allowed, fallback) {
  const clean = String(value || '').toLowerCase().replace(/\s+/g, '_');
  return allowed.includes(clean) ? clean : fallback;
}

function readMemorySnippets(classification) {
  const paths = [
    'wiki/context/property-operating-facts.md',
    'wiki/context/durham-city.md',
    'wiki/context/energy-contracts-and-suppliers.md',
    'wiki/context/workmen-team-contractors.md',
    'wiki/context/email-correspondence.md',
    'raw/recent-whatsapp.md',
    'raw/recent-email.md'
  ];
  if (classification?.domain === 'short_lets') {
    paths.unshift('wiki/context/property-operating-facts.md');
  }

  try {
    const businessMemory = require('./business-memory');
    return paths.map(filePath => {
      try {
        const file = businessMemory.readMemoryFile(filePath);
        return { path: filePath, content: truncate(file.content, 2200) };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function refineEmailClassificationWithAI({ heuristic, subject, body, fromEmail, fromName, tenant, issue, memory }) {
  let refined = { ...heuristic };
  const memorySnippets = readMemorySnippets(heuristic);
  try {
    const { callLLM } = require('./llm');
    const prompt = `You classify inbound email for FFR Property OS.

The goal is to decide whether the email is:
- a task the team must act on,
- a reply-needed human correspondence,
- an automated notification that should only enrich Business Memory,
- or short-let platform context from Airbnb, Booking.com, Expedia, etc.

Known short-let properties include 52 Old Elvet, 2 St Margarets Mews, 35 St Andrews Court and 7 Cathedrals.
Booking.com, Expedia, Airbnb and similar platform emails usually relate to short-term lets at those properties unless context proves otherwise.

Heuristic classification:
${JSON.stringify(heuristic, null, 2)}

Matched tenant: ${tenant ? `${tenant.name} at ${tenant.property_name || tenant.flat_number || 'unknown property'}` : 'none'}
Matched issue: ${issue ? `${issue.uuid || issue.id}: ${issue.title}` : 'none'}

Relevant Business Memory summary:
${formatInternalMemoryBrief(memory) || 'No close match in stored emails/WhatsApp/tasks.'}

Memory file snippets:
${memorySnippets.map(snippet => `--- ${snippet.path} ---\n${snippet.content}`).join('\n\n') || 'No memory files available yet.'}

Email:
From: ${fromName || ''} <${fromEmail || ''}>
Subject: ${subject || ''}
Body preview:
${truncate(body, 5000)}

Return ONLY valid JSON with this exact shape:
{
  "domain": "maintenance|finance|compliance|leasing|short_lets|utilities|contractors|operations|development",
  "priority": "low|medium|high|urgent",
  "message_kind": "task|reply_needed|notification|automated|booking|context|correspondence",
  "is_automated": true,
  "needs_reply": false,
  "needs_team_followup": true,
  "suggested_owner": "email address or team name",
  "summary": "one sentence",
  "risk_level": "low|medium|high",
  "suggested_action": "specific next action or file for context",
  "property_hints": ["property names"],
  "supplier_or_channel": "supplier/channel/person if clear",
  "confidence": 0.0
}`;

    const response = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 700 });
    const parsed = parseJsonObject(response);
    if (parsed) {
      refined = {
        ...refined,
        domain: clampChoice(parsed.domain, ['maintenance', 'finance', 'compliance', 'leasing', 'short_lets', 'utilities', 'contractors', 'operations', 'development'], refined.domain),
        priority: clampChoice(parsed.priority, ['low', 'medium', 'high', 'urgent'], refined.priority),
        message_kind: clampChoice(parsed.message_kind, ['task', 'reply_needed', 'notification', 'automated', 'booking', 'context', 'correspondence'], refined.message_kind || 'correspondence'),
        is_automated: boolFlag(parsed.is_automated),
        needs_reply: boolFlag(parsed.needs_reply),
        needs_team_followup: boolFlag(parsed.needs_team_followup),
        suggested_owner: parsed.suggested_owner || refined.suggested_owner,
        summary: truncate(parsed.summary || refined.summary, 240),
        risk_level: clampChoice(parsed.risk_level, ['low', 'medium', 'high'], refined.risk_level || 'medium'),
        classification_source: 'ai_memory',
        detected_entities: {
          ...(refined.detected_entities || {}),
          property_hints: Array.isArray(parsed.property_hints) ? parsed.property_hints.filter(Boolean).slice(0, 8) : refined.detected_entities?.property_hints || [],
          supplier_or_channel: parsed.supplier_or_channel || refined.detected_entities?.supplier_or_channel || null,
          confidence: Number(parsed.confidence || 0) || null
        },
        action: {
          ...(refined.action || {}),
          suggested_action: parsed.suggested_action || refined.action?.suggested_action || 'Review and file.',
          requires_human_approval: boolFlag(parsed.needs_reply) || refined.action?.requires_human_approval || false
        }
      };
    }
  } catch (error) {
    refined.classification_source = 'heuristic';
  }

  const automated = refined.is_automated || isLikelyAutomatedEmail(fromEmail, subject, body);
  if (automated) refined.is_automated = 1;
  if (automated && isNoReplyAddress(fromEmail)) refined.needs_reply = 0;
  if (refined.message_kind === 'notification' || refined.message_kind === 'automated') {
    refined.needs_reply = 0;
  }
  if (refined.message_kind === 'reply_needed') refined.needs_reply = 1;
  if (refined.message_kind === 'task' || refined.message_kind === 'booking') refined.needs_team_followup = 1;
  refined.needs_reply = boolFlag(refined.needs_reply);
  refined.needs_team_followup = boolFlag(refined.needs_team_followup);
  refined.memory_files = memorySnippets.map(snippet => snippet.path);
  return refined;
}

function classifyEmail({ subject = '', body = '', fromEmail = '', fromName = '', tenant = null, issueId = null }) {
  const text = `${subject}\n${body}`.toLowerCase();
  const has = (...patterns) => patterns.some(pattern => pattern.test(text));
  const automated = isLikelyAutomatedEmail(fromEmail, subject, body);
  const commercialContext = detectCommercialContext({ subject, body, fromEmail, fromName });

  let domain = 'operations';
  if (issueId || has(/repair/, /broken/, /leak/, /heating/, /boiler/, /plumb/, /electric/, /damp/, /mould/, /toilet/, /shower/, /lock/, /window/, /door/)) {
    domain = 'maintenance';
  }
  if (has(/invoice/, /payment/, /paid/, /arrears?/, /rent/, /deposit/, /refund/, /statement/, /receipt/, /bank/, /transfer/)) {
    domain = 'finance';
  }
  if (has(/gas safety/, /\beicr\b/, /\bepc\b/, /\bhmo\b/, /fire/, /alarm/, /certificate/, /licen[cs]e/, /notice/, /legal/)) {
    domain = 'compliance';
  }
  if (has(/contract/, /tenancy/, /guarantor/, /viewing/, /reservation/, /move[- ]?in/, /move[- ]?out/, /keys?/, /rent offer/)) {
    domain = 'leasing';
  }
  if (commercialContext.is_short_let || has(/booking/, /guest/, /airbnb/, /guesty/, /cleaning/, /linen/, /check[- ]?in/, /check[- ]?out/)) {
    domain = 'short_lets';
  }
  if (has(/utility/, /meter/, /electricity/, /water bill/, /gas bill/, /supplier/, /octopus/, /edf/, /british gas/)) {
    domain = 'utilities';
  }
  if (has(/quote/, /contractor/, /job complete/, /attendance/, /call[- ]?out/, /day rate/)) {
    domain = 'contractors';
  }

  let priority = 'medium';
  if (has(/urgent/, /emergency/, /asap/, /immediately/, /no heating/, /no hot water/, /active leak/, /flood/, /fire/, /break[- ]?in/, /unsafe/, /danger/)) {
    priority = 'urgent';
  } else if (has(/chase/, /overdue/, /deadline/, /today/, /tomorrow/, /complaint/, /unhappy/, /final notice/)) {
    priority = 'high';
  } else if (has(/fyi/, /for your records/, /newsletter/, /statement attached/)) {
    priority = 'low';
  }

  const clearlyInformational = has(/fyi only/, /for your records/, /no action required/, /statement attached/, /receipt attached/, /newsletter/, /unsubscribe/);
  const directAsk = /\?/.test(subject) ||
    /\?/.test(body) ||
    has(/can you/, /could you/, /please/, /let me know/, /confirm/, /advise/, /reply/, /respond/, /follow up/, /chase/, /would you/, /are you able/, /need help/, /need to arrange/);

  const needsReply = !automated && !clearlyInformational && (
    directAsk ||
    domain !== 'operations' ||
    !!tenant ||
    /^(re|fw|fwd):/i.test(subject || '')
  );

  const needsTeamFollowup = priority !== 'low' && (
    domain !== 'operations' ||
    directAsk ||
    has(/need to/, /please can/, /can someone/, /make sure/, /book/, /arrange/, /send/, /pay/, /approve/, /sign/, /deadline/, /chase/)
  );
  const shortLetNeedsAction = commercialContext.is_short_let && commercialContext.short_let_action;
  const messageKind = automated
    ? (shortLetNeedsAction ? 'booking' : 'notification')
    : needsReply ? 'reply_needed' : needsTeamFollowup ? 'task' : clearlyInformational ? 'context' : 'correspondence';

  const highRisk = domain === 'finance' || domain === 'compliance' || has(/legal/, /notice/, /deposit/, /payment/, /bank/, /contract/, /evict/, /claim/, /refund/);
  const ownerByDomain = {
    maintenance: 'andy@52oldelvet.com',
    contractors: 'andy@52oldelvet.com',
    finance: 'akiel@52oldelvet.com',
    utilities: 'akiel@52oldelvet.com',
    leasing: 'hannah@52oldelvet.com',
    short_lets: 'hannah@52oldelvet.com',
    compliance: 'fergus@fiftytwo-group.com',
    development: 'fergus@fiftytwo-group.com',
    operations: 'hannah@52oldelvet.com'
  };

  const sender = fromName || fromEmail || 'Unknown sender';
  const summary = truncate(`${sender}: ${subject || 'No subject'}`, 180);
  const suggestedAction = needsTeamFollowup
    ? `Review ${domain.replace(/_/g, ' ')} email and decide owner/action.`
    : 'File for awareness unless further context arrives.';

  return {
    domain,
    priority,
    message_kind: messageKind,
    is_automated: automated ? 1 : 0,
    classification_source: 'heuristic',
    needs_reply: needsReply ? 1 : 0,
    needs_team_followup: (needsTeamFollowup || shortLetNeedsAction) ? 1 : 0,
    suggested_owner: ownerByDomain[domain] || ownerByDomain.operations,
    summary,
    risk_level: highRisk ? 'high' : priority === 'urgent' ? 'high' : 'medium',
    detected_entities: {
      property_hints: commercialContext.property_hints,
      supplier_or_channel: commercialContext.channel,
      booking_reference: commercialContext.booking_reference
    },
    action: {
      suggested_action: suggestedAction,
      requires_human_approval: highRisk || needsReply,
      tenant_id: tenant?.id || null,
      issue_id: issueId || null
    }
  };
}

function buildReplyDraft({ fromName, subject, classification, tenant, issue, memory }) {
  const greetingName = firstName(fromName || tenant?.name);
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hi,';
  const safeSubject = subject ? subject.replace(/^re:\s*/i, '') : 'your email';
  const issueLine = issue
    ? `We have logged this on FFR Property OS as issue ${issue.uuid || issue.id}: ${issue.title || safeSubject}.`
    : 'I have picked this up and logged it for the team to review.';

  const domainLines = {
    maintenance: 'The team will review the details and come back with the next step or any access questions.',
    finance: 'We will check the account records before confirming anything financial.',
    compliance: 'We will check the relevant property records and come back once the evidence has been reviewed.',
    leasing: 'We will review the tenancy/leasing details and come back with the right next step.',
    utilities: 'We will check the meter, supplier and billing records before confirming the position.',
    contractors: 'We will check this against the job record and contractor notes.',
    short_lets: 'We will check the booking and operational calendar before confirming.',
    operations: 'We will review and come back shortly.'
  };

  const urgencyLine = classification.priority === 'urgent'
    ? '\n\nIf this is an immediate safety issue, please call the emergency contact route as well as replying here.'
    : '';

  const memorySummary = summariseBusinessMemory(memory || {
    previousEmails: [],
    previousEmailLogs: [],
    tenantEmails: [],
    domainEmails: [],
    relatedIssues: [],
    whatsappIssueMessages: [],
    whatsappIntakeByPerson: [],
    whatsappIntakeByDomain: [],
    openTasks: []
  });

  const contextLines = [];
  const openIssue = (memory?.relatedIssues || []).find(item => ['open', 'in_progress', 'escalated'].includes(item.status));
  if (openIssue && (!issue || openIssue.id !== issue.id)) {
    contextLines.push(`I can see we already have a related item open on our side (${openIssue.uuid || openIssue.id}: ${openIssue.title}), so I have kept this with that context.`);
  }
  if (memorySummary.previous_email_count > 0 || memorySummary.previous_email_log_count > 0) {
    const latestSubject = memorySummary.latest_previous_email_subjects[0];
    contextLines.push(latestSubject
      ? `I have also taken the earlier correspondence about "${latestSubject}" into account.`
      : 'I have also taken the earlier correspondence into account.');
  }
  if (memorySummary.whatsapp_issue_message_count > 0 || memorySummary.whatsapp_intake_person_count > 0 || memorySummary.whatsapp_intake_domain_count > 0) {
    contextLines.push('I have added this to the existing internal notes and WhatsApp context for the team.');
  }
  if (memorySummary.open_task_count > 0) {
    const owner = memory.openTasks.find(task => task.assigned_to)?.assigned_to;
    contextLines.push(owner ? `This is flagged for follow-up with ${owner}.` : 'This is flagged for team follow-up.');
  }
  const contextBlock = contextLines.length ? `\n\n${contextLines.join(' ')}` : '';

  return `${greeting}

Thanks for your email about ${safeSubject}.

${issueLine} ${domainLines[classification.domain] || domainLines.operations}${contextBlock}${urgencyLine}

Best,
52 Old Elvet Team`;
}

function recordEvent(db, eventType, domain, sourceRef, payload = {}) {
  db.prepare(`
    INSERT INTO agent_events (event_type, domain, source, source_ref, actor, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventType, domain, 'email_agent', sourceRef || null, 'admin_email_agent', JSON.stringify(payload));
}

async function recordEmailItem({ accountId, messageId, gmailThreadId, fromEmail, fromName, subject, body, matchedTenantId, issueId, status }) {
  const db = getDb();
  try {
    const existing = db.prepare('SELECT id FROM email_agent_items WHERE message_id = ?').get(messageId);
    if (existing) return { skipped: true, id: existing.id };

    const account = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(accountId);
    const tenant = matchedTenantId
      ? db.prepare('SELECT t.*, p.name as property_name FROM tenants t LEFT JOIN properties p ON t.property_id = p.id WHERE t.id = ?').get(matchedTenantId)
      : null;
    const issue = issueId ? db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId) : null;
    const log = db.prepare('SELECT id FROM email_sync_log WHERE message_id = ?').get(messageId);
    const heuristicClassification = classifyEmail({ subject, body, fromEmail, fromName, tenant, issueId });
    let memory = buildBusinessMemory(db, { messageId, fromEmail, fromName, tenant, issue, classification: heuristicClassification });
    let classification = await refineEmailClassificationWithAI({
      heuristic: heuristicClassification,
      subject,
      body,
      fromEmail,
      fromName,
      tenant,
      issue,
      memory
    });
    if (classification.domain !== heuristicClassification.domain) {
      memory = buildBusinessMemory(db, { messageId, fromEmail, fromName, tenant, issue, classification });
    }
    const memorySummary = summariseBusinessMemory(memory);
    const actionWithMemory = {
      ...classification.action,
      business_memory: memorySummary,
      detected_entities: classification.detected_entities || {},
      classification_source: classification.classification_source || 'heuristic'
    };
    const memoryRefs = {
      files: classification.memory_files || [],
      previous_email_count: memorySummary.previous_email_count,
      whatsapp_context_count: memorySummary.whatsapp_issue_message_count + memorySummary.whatsapp_intake_person_count + memorySummary.whatsapp_intake_domain_count,
      related_issue_count: memorySummary.related_issue_count,
      open_task_count: memorySummary.open_task_count
    };

    const itemId = db.prepare(`
      INSERT INTO email_agent_items (
        email_account_id, email_sync_log_id, message_id, from_address, from_name, subject, body_preview,
        matched_tenant_id, issue_id, domain, priority, message_kind, is_automated, classification_source,
        status, needs_reply, needs_team_followup, suggested_owner, summary, action_json, memory_refs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId,
      log?.id || null,
      messageId,
      fromEmail || null,
      fromName || null,
      subject || null,
      truncate(body, 1600),
      matchedTenantId || null,
      issueId || null,
      classification.domain,
      classification.priority,
      classification.message_kind || 'correspondence',
      classification.is_automated ? 1 : 0,
      classification.classification_source || 'heuristic',
      status || 'processed',
      classification.needs_reply,
      classification.needs_team_followup,
      classification.suggested_owner,
      classification.summary,
      JSON.stringify(actionWithMemory),
      JSON.stringify(memoryRefs)
    ).lastInsertRowid;

    let draftId = null;
    let gmailDraftId = null;
    let gmailDraftStatus = null;
    if (classification.needs_reply && fromEmail && !isNoReplyAddress(fromEmail) && isManagedInboxAccount(account)) {
      const draftBody = buildReplyDraft({ fromName, subject, classification, tenant, issue, memory });
      draftId = db.prepare(`
        INSERT INTO email_agent_drafts (email_agent_item_id, email_account_id, message_id, gmail_thread_id, to_address, subject, body_text, gmail_draft_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(itemId, accountId, messageId, gmailThreadId || null, fromEmail, subject ? `Re: ${subject.replace(/^re:\s*/i, '')}` : 'Re: Your email', draftBody, 'pending').lastInsertRowid;

      if (account?.provider === 'gmail') {
        try {
          const gmailDraft = await createGmailDraft(account, {
            to: fromEmail,
            subject: subject ? `Re: ${subject.replace(/^re:\s*/i, '')}` : 'Re: Your email',
            bodyText: draftBody,
            threadId: gmailThreadId
          });
          gmailDraftId = gmailDraft?.id || null;
          gmailDraftStatus = gmailDraftId ? 'created' : 'not_created';
          db.prepare(`
            UPDATE email_agent_drafts
            SET gmail_draft_id = ?, gmail_draft_status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(gmailDraftId, gmailDraftStatus, draftId);
        } catch (error) {
          gmailDraftStatus = 'failed';
          const message = /insufficient|forbidden|scope|permission/i.test(error.message || '')
            ? 'Gmail draft creation failed. Reconnect the Gmail account in Settings so it grants Gmail compose permission.'
            : error.message;
          db.prepare(`
            UPDATE email_agent_drafts
            SET gmail_draft_status = ?, error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(gmailDraftStatus, message, draftId);
          console.error('[EmailAgent] Gmail draft creation failed:', message);
        }
      } else {
        db.prepare(`
          UPDATE email_agent_drafts
          SET gmail_draft_status = ?, error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run('not_gmail', 'Connect admin@52oldelvet.com with Gmail OAuth to create real Gmail drafts.', draftId);
      }

      db.prepare(`
        INSERT INTO agent_approvals (action_type, title, summary, payload_json, risk_level, requested_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'send_email_reply',
        `Review reply draft: ${subject || fromEmail}`,
        gmailDraftId
          ? `Gmail Draft created for ${fromEmail} by Admin Email Agent.`
          : `Reply draft to ${fromEmail} created by Admin Email Agent.`,
        JSON.stringify({ draft_id: draftId, gmail_draft_id: gmailDraftId, email_agent_item_id: itemId, to: fromEmail, subject }),
        classification.risk_level,
        'admin_email_agent'
      );
    }

    if (classification.needs_team_followup) {
      const taskId = db.prepare(`
        INSERT INTO agent_tasks (title, description, domain, tenant_id, issue_id, priority, source, source_ref, assigned_to, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `Email follow-up: ${subject || fromEmail || 'No subject'}`.slice(0, 140),
        `${classification.summary}\n\nSuggested action: ${classification.action.suggested_action}\n\nContext considered:\n${formatInternalMemoryBrief(memory) || 'No previous email or WhatsApp context found yet.'}\n\nPreview: ${truncate(body, 700)}`,
        classification.domain,
        matchedTenantId || null,
        issueId || null,
        classification.priority,
        'email_agent',
        messageId,
        classification.suggested_owner,
        'admin_email_agent'
      ).lastInsertRowid;

      recordEvent(db, 'email_task_created', classification.domain, messageId, { task_id: taskId, draft_id: draftId });
    } else {
      recordEvent(db, 'email_item_processed', classification.domain, messageId, { draft_id: draftId });
    }

    return { id: itemId, draft_id: draftId, gmail_draft_id: gmailDraftId, gmail_draft_status: gmailDraftStatus, classification, memory: memorySummary, account: account?.email_address || null };
  } finally {
    db.close();
  }
}

function getSummary() {
  const db = getDb();
  try {
    const adminAccount = db.prepare(`
      SELECT id, provider, email_address, last_sync_at, sync_enabled
      FROM email_accounts
      WHERE LOWER(email_address) = LOWER(?)
      ORDER BY id DESC
      LIMIT 1
    `).get(process.env.EMAIL_AGENT_INBOX || 'admin@52oldelvet.com');

    const totals = db.prepare(`
      SELECT
        COUNT(*) as items,
        COALESCE(SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END), 0) as today,
        COALESCE(SUM(CASE WHEN needs_reply = 1 THEN 1 ELSE 0 END), 0) as needs_reply,
        COALESCE(SUM(CASE WHEN needs_team_followup = 1 THEN 1 ELSE 0 END), 0) as needs_followup
      FROM email_agent_items
    `).get();

    const drafts = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM email_agent_drafts
      GROUP BY status
    `).all();

    const domains = db.prepare(`
      SELECT domain, COUNT(*) as count
      FROM email_agent_items
      GROUP BY domain
      ORDER BY count DESC
    `).all();

    const latestReport = db.prepare('SELECT * FROM email_agent_reports ORDER BY report_date DESC LIMIT 1').get();
    return { admin_account: adminAccount || null, totals, drafts, domains, team_recipients: getTeamRecipients(), latest_report: latestReport || null };
  } finally {
    db.close();
  }
}

function getItems(limit = 100) {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT ei.*, ea.email_address as account_email, t.name as tenant_name, i.uuid as issue_uuid, i.title as issue_title
      FROM email_agent_items ei
      LEFT JOIN email_accounts ea ON ei.email_account_id = ea.id
      LEFT JOIN tenants t ON ei.matched_tenant_id = t.id
      LEFT JOIN issues i ON ei.issue_id = i.id
      ORDER BY ei.created_at DESC
      LIMIT ?
    `).all(Number(limit) || 100);
  } finally {
    db.close();
  }
}

function getDrafts(status = 'draft', limit = 100) {
  const db = getDb();
  try {
    const params = [];
    let where = '';
    if (status && status !== 'all') {
      where = 'WHERE d.status = ?';
      params.push(status);
    }
    params.push(Number(limit) || 100);
    return db.prepare(`
      SELECT d.*, ei.domain, ei.priority, ei.summary, ei.suggested_owner, ea.email_address as account_email
      FROM email_agent_drafts d
      LEFT JOIN email_agent_items ei ON d.email_agent_item_id = ei.id
      LEFT JOIN email_accounts ea ON d.email_account_id = ea.id
      ${where}
      ORDER BY d.created_at DESC
      LIMIT ?
    `).all(...params);
  } finally {
    db.close();
  }
}

function updateDraft(id, { subject, body_text, status }, actor = 'user') {
  const db = getDb();
  try {
    const draft = db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
    if (!draft) throw new Error('Draft not found');
    db.prepare(`
      UPDATE email_agent_drafts
      SET subject = ?, body_text = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(subject || draft.subject, body_text || draft.body_text, status || draft.status, id);
    recordEvent(db, 'email_draft_updated', 'operations', String(id), { actor });
    return db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
  } finally {
    db.close();
  }
}

function approveDraft(id, actor = 'user') {
  const db = getDb();
  try {
    const draft = db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
    if (!draft) throw new Error('Draft not found');
    db.prepare(`
      UPDATE email_agent_drafts
      SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(actor, id);
    recordEvent(db, 'email_draft_approved', 'operations', String(id), { actor });
    return db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
  } finally {
    db.close();
  }
}

async function sendDraft(id, actor = 'user') {
  const db = getDb();
  let draft;
  try {
    draft = db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
  } finally {
    db.close();
  }
  if (!draft) throw new Error('Draft not found');
  if (draft.status !== 'approved') throw new Error('Draft must be approved before sending');

  try {
    await sendGenericEmail({
      to: draft.to_address,
      subject: draft.subject,
      text: draft.body_text,
      fromName: '52 Old Elvet'
    });

    const db2 = getDb();
    try {
      db2.prepare(`
        UPDATE email_agent_drafts
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, error = NULL
        WHERE id = ?
      `).run(id);
      recordEvent(db2, 'email_draft_sent', 'operations', String(id), { actor, to: draft.to_address });
    } finally {
      db2.close();
    }
    return { success: true };
  } catch (error) {
    const db3 = getDb();
    try {
      db3.prepare('UPDATE email_agent_drafts SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(error.message, id);
    } finally {
      db3.close();
    }
    throw error;
  }
}

function buildDailyReport(date = todayKey()) {
  const db = getDb();
  try {
    const items = db.prepare(`
      SELECT ei.*, ea.email_address as account_email, t.name as tenant_name, i.uuid as issue_uuid, i.title as issue_title
      FROM email_agent_items ei
      LEFT JOIN email_accounts ea ON ei.email_account_id = ea.id
      LEFT JOIN tenants t ON ei.matched_tenant_id = t.id
      LEFT JOIN issues i ON ei.issue_id = i.id
      WHERE DATE(ei.created_at) = DATE(?)
      ORDER BY
        CASE ei.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        ei.created_at DESC
    `).all(date);

    const tasks = db.prepare(`
      SELECT t.*, p.name as property_name, ten.name as tenant_name, i.uuid as issue_uuid
      FROM agent_tasks t
      LEFT JOIN properties p ON p.id = t.property_id
      LEFT JOIN tenants ten ON ten.id = t.tenant_id
      LEFT JOIN issues i ON i.id = t.issue_id
      WHERE t.status = 'open'
      ORDER BY
        CASE WHEN t.due_date IS NOT NULL AND DATE(t.due_date) <= DATE(?) THEN 0 ELSE 1 END,
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        COALESCE(t.due_date, '9999-12-31') ASC,
        t.created_at DESC
      LIMIT 30
    `).all(date);

    const drafts = db.prepare(`
      SELECT d.*, ei.domain, ei.priority, ei.summary, ea.email_address as account_email
      FROM email_agent_drafts d
      LEFT JOIN email_agent_items ei ON d.email_agent_item_id = ei.id
      LEFT JOIN email_accounts ea ON d.email_account_id = ea.id
      WHERE DATE(d.created_at) = DATE(?) AND d.status IN ('draft', 'approved')
      ORDER BY d.created_at DESC
    `).all(date);

    const openIssues = db.prepare(`
      SELECT i.*, t.name as tenant_name, p.name as property_name
      FROM issues i
      LEFT JOIN tenants t ON t.id = i.tenant_id
      LEFT JOIN properties p ON p.id = i.property_id
      WHERE i.status NOT IN ('resolved', 'closed')
      ORDER BY
        CASE i.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        CASE i.status WHEN 'escalated' THEN 0 ELSE 1 END,
        i.updated_at DESC
      LIMIT 15
    `).all();

    const approvals = db.prepare(`
      SELECT *
      FROM agent_approvals
      WHERE status = 'pending'
      ORDER BY CASE risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC
      LIMIT 15
    `).all();

    const calendarEvents = db.prepare(`
      SELECT ce.*, ca.email_address as account_email, ca.calendar_name
      FROM calendar_events ce
      LEFT JOIN calendar_accounts ca ON ca.id = ce.calendar_account_id
      WHERE ce.start_at IS NOT NULL
        AND substr(ce.start_at, 1, 10) BETWEEN DATE(?) AND DATE(?, '+1 day')
      ORDER BY ce.start_at ASC
      LIMIT 20
    `).all(date, date);

    const compliance = db.prepare(`
      SELECT c.*, p.name as property_name
      FROM compliance_certificates c
      LEFT JOIN properties p ON p.id = c.property_id
      WHERE c.expiry_date IS NOT NULL AND DATE(c.expiry_date) <= DATE(?, '+45 days')
      ORDER BY c.expiry_date ASC
      LIMIT 12
    `).all(date);

    const intake = db.prepare(`
      SELECT e.*, i.sender, i.source_name, i.source_type, i.occurred_at
      FROM intake_extractions e
      LEFT JOIN intake_items i ON i.id = e.intake_item_id
      WHERE DATE(e.created_at) = DATE(?) OR DATE(i.occurred_at) = DATE(?)
      ORDER BY CASE e.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, e.created_at DESC
      LIMIT 12
    `).all(date, date);

    const propertyPulse = db.prepare(`
      SELECT p.name,
        COUNT(i.id) as open_issues,
        SUM(CASE WHEN i.priority IN ('urgent','high') THEN 1 ELSE 0 END) as high_priority
      FROM properties p
      LEFT JOIN issues i ON i.property_id = p.id AND i.status NOT IN ('resolved','closed')
      GROUP BY p.id
      HAVING open_issues > 0
      ORDER BY high_priority DESC, open_issues DESC, p.name COLLATE NOCASE
      LIMIT 10
    `).all();

    const domainCounts = items.reduce((acc, item) => {
      acc[item.domain] = (acc[item.domain] || 0) + 1;
      return acc;
    }, {});
    const urgentIssues = openIssues.filter(issue => issue.priority === 'urgent' || issue.status === 'escalated');
    const highRiskApprovals = approvals.filter(approval => approval.risk_level === 'high');
    const shortLetItems = items.filter(item => item.domain === 'short_lets');
    const automatedNotifications = items.filter(item => item.is_automated);
    const replyNeeded = items.filter(item => item.needs_reply);
    const dueToday = tasks.filter(task => task.due_date && task.due_date <= date);

    const narrative = [
      urgentIssues.length ? `${urgentIssues.length} urgent/escalated maintenance item${urgentIssues.length === 1 ? '' : 's'} need attention.` : 'No urgent maintenance escalations are currently open.',
      replyNeeded.length ? `${replyNeeded.length} email${replyNeeded.length === 1 ? '' : 's'} need a reply; ${drafts.length} draft${drafts.length === 1 ? '' : 's'} are waiting.` : 'No reply-required email was processed today.',
      approvals.length ? `${approvals.length} approval${approvals.length === 1 ? '' : 's'} are pending${highRiskApprovals.length ? `, including ${highRiskApprovals.length} high-risk` : ''}.` : 'No pending approvals are blocking the team.',
      calendarEvents.length ? `${calendarEvents.length} calendar event${calendarEvents.length === 1 ? '' : 's'} are synced for today/tomorrow.` : 'No synced calendar events are currently visible for today/tomorrow.',
      intake.length ? `${intake.length} WhatsApp/intake signal${intake.length === 1 ? '' : 's'} were captured today.` : '',
      dueToday.length ? `${dueToday.length} task${dueToday.length === 1 ? '' : 's'} are due today.` : '',
      shortLetItems.length ? `${shortLetItems.length} short-let platform/context item${shortLetItems.length === 1 ? '' : 's'} arrived today.` : ''
    ].filter(Boolean);

    const subject = `FFR Property OS team brief - ${date}`;
    const lines = [
      `FFR Property OS team brief - ${date}`,
      '',
      'Executive context:',
      ...narrative.map(line => `- ${line}`),
      '',
      `Inbox/context handled: ${items.length}`,
      `Reply drafts waiting: ${drafts.length}`,
      `Open team tasks: ${tasks.length}`,
      `Pending approvals: ${approvals.length}`,
      `Calendar events today/tomorrow: ${calendarEvents.length}`,
      '',
      'Domain mix:',
      ...Object.entries(domainCounts).map(([domain, count]) => `- ${domain.replace(/_/g, ' ')}: ${count}`),
      ...(Object.keys(domainCounts).length === 0 ? ['- No email domains processed today.'] : []),
      '',
      'Calendar context:',
      ...(calendarEvents.slice(0, 12).map(event => `- ${formatBriefDateTime(event.start_at)}: ${event.summary}${event.location ? ` (${event.location})` : ''}`)),
      ...(calendarEvents.length === 0 ? ['- No synced calendar events for today/tomorrow.'] : []),
      '',
      'Urgent/open property work:',
      ...(openIssues.slice(0, 12).map(issue => `- [${issue.priority}] ${issue.uuid || issue.id} ${issue.title} at ${issue.property_name || 'unknown property'} (${issue.status})`)),
      ...(openIssues.length === 0 ? ['- No open issues.'] : []),
      '',
      'Important email items:',
      ...(items.slice(0, 12).map(item => `- [${item.priority}] ${item.message_kind || 'email'} ${item.summary}${item.account_email ? ` (${item.account_email})` : ''}${item.issue_uuid ? ` (issue ${item.issue_uuid})` : ''}`)),
      ...(items.length === 0 ? ['- No new email items were processed by the agent today.'] : []),
      '',
      'Short-let and automated context:',
      ...(shortLetItems.slice(0, 8).map(item => `- ${item.summary}${item.needs_team_followup ? ' (follow-up)' : ''}`)),
      ...(shortLetItems.length === 0 && automatedNotifications.length ? automatedNotifications.slice(0, 8).map(item => `- ${item.summary} (automated ${item.domain})`) : []),
      ...(shortLetItems.length === 0 && automatedNotifications.length === 0 ? ['- No short-let or automated context highlighted today.'] : []),
      '',
      'WhatsApp/intake signals:',
      ...(intake.slice(0, 8).map(item => `- [${item.priority}] ${item.title}: ${item.summary || item.sender || item.source_name || ''}`)),
      ...(intake.length === 0 ? ['- No WhatsApp/intake signals captured today.'] : []),
      '',
      'Team reminders:',
      ...(tasks.slice(0, 12).map(task => `- ${task.assigned_to || 'Unassigned'}: ${task.title} (${task.priority}${task.due_date ? `, due ${task.due_date}` : ''})`)),
      ...(tasks.length === 0 ? ['- No open team tasks.'] : []),
      '',
      'Pending approvals:',
      ...(approvals.slice(0, 10).map(approval => `- [${approval.risk_level}] ${approval.title}`)),
      ...(approvals.length === 0 ? ['- No pending approvals.'] : []),
      '',
      'Drafts for approval:',
      ...(drafts.slice(0, 10).map(draft => `- ${draft.to_address}: ${draft.subject} (${draft.status})`)),
      ...(drafts.length === 0 ? ['- No reply drafts waiting.'] : []),
      '',
      'Property pulse:',
      ...(propertyPulse.slice(0, 8).map(row => `- ${row.name}: ${row.open_issues} open issue${row.open_issues === 1 ? '' : 's'}${row.high_priority ? `, ${row.high_priority} high priority` : ''}`)),
      ...(propertyPulse.length === 0 ? ['- No properties with open issue pressure.'] : []),
      '',
      'Compliance watch:',
      ...(compliance.slice(0, 8).map(cert => `- ${cert.property_name || 'Unknown property'}: ${cert.cert_type} expires ${cert.expiry_date}`)),
      ...(compliance.length === 0 ? ['- No compliance certificates expiring in the next 45 days.'] : []),
      '',
      'This report is generated from connected inboxes, Google Calendar sync, WhatsApp/intake, FFR Property OS tasks, approvals, compliance and property records.'
    ];

    const bodyText = lines.join('\n');
    const metricCards = [
      { label: 'Emails handled', value: items.length },
      { label: 'Drafts waiting', value: drafts.length },
      { label: 'Open tasks', value: tasks.length },
      { label: 'Approvals', value: approvals.length },
      { label: 'Calendar', value: calendarEvents.length },
      { label: 'Urgent issues', value: urgentIssues.length }
    ];
    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; color: #172033;">
        <h2 style="margin-bottom: 4px;">FFR Property OS team brief</h2>
        <p style="color: #64748b; margin-top: 0;">${date}</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin:16px 0;">
          <strong>Context first</strong>
          <ul style="margin:8px 0 0 18px;padding:0;">${htmlList(narrative, line => htmlEscape(line))}</ul>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 18px 0;">
          ${metricCards.map(card => `<div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;"><strong>${card.value}</strong><br><span style="color:#64748b;">${htmlEscape(card.label)}</span></div>`).join('')}
        </div>
        <h3>Calendar context</h3>
        <ul>${htmlList(calendarEvents.slice(0, 12), event => `${htmlEscape(formatBriefDateTime(event.start_at))}: ${htmlEscape(event.summary)}${event.location ? ` <span style="color:#64748b;">(${htmlEscape(event.location)})</span>` : ''}`, '<li>No synced calendar events for today/tomorrow.</li>')}</ul>
        <h3>Urgent/open property work</h3>
        <ul>${htmlList(openIssues.slice(0, 12), issue => `<strong>${htmlEscape(issue.priority)}</strong> - ${htmlEscape(issue.uuid || issue.id)} ${htmlEscape(issue.title)} at ${htmlEscape(issue.property_name || 'unknown property')} <span style="color:#64748b;">(${htmlEscape(issue.status)})</span>`, '<li>No open issues.</li>')}</ul>
        <h3>Important email items</h3>
        <ul>${htmlList(items.slice(0, 12), item => `<strong>${htmlEscape(item.priority)}</strong> - ${htmlEscape(item.message_kind || 'email')} - ${htmlEscape(item.summary)}${item.issue_uuid ? ` <span style="color:#64748b;">(issue ${htmlEscape(item.issue_uuid)})</span>` : ''}`, '<li>No new email items were processed by the agent today.</li>')}</ul>
        <h3>Short-let and automated context</h3>
        <ul>${htmlList((shortLetItems.length ? shortLetItems : automatedNotifications).slice(0, 8), item => `${htmlEscape(item.summary)}${item.needs_team_followup ? ' <strong>follow-up</strong>' : ''}`, '<li>No short-let or automated context highlighted today.</li>')}</ul>
        <h3>WhatsApp/intake signals</h3>
        <ul>${htmlList(intake.slice(0, 8), item => `<strong>${htmlEscape(item.priority)}</strong> - ${htmlEscape(item.title)}${item.summary ? `: ${htmlEscape(item.summary)}` : ''}`, '<li>No WhatsApp/intake signals captured today.</li>')}</ul>
        <h3>Team reminders</h3>
        <ul>${htmlList(tasks.slice(0, 12), task => `${htmlEscape(task.assigned_to || 'Unassigned')}: ${htmlEscape(task.title)} <span style="color:#64748b;">(${htmlEscape(task.priority)}${task.due_date ? `, due ${htmlEscape(task.due_date)}` : ''})</span>`, '<li>No open team tasks.</li>')}</ul>
        <h3>Pending approvals</h3>
        <ul>${htmlList(approvals.slice(0, 10), approval => `<strong>${htmlEscape(approval.risk_level)}</strong> - ${htmlEscape(approval.title)}`, '<li>No pending approvals.</li>')}</ul>
        <h3>Drafts for approval</h3>
        <ul>${htmlList(drafts.slice(0, 10), draft => `${htmlEscape(draft.to_address)}: ${htmlEscape(draft.subject)} <span style="color:#64748b;">(${htmlEscape(draft.status)})</span>`, '<li>No reply drafts waiting.</li>')}</ul>
        <h3>Property pulse</h3>
        <ul>${htmlList(propertyPulse.slice(0, 8), row => `${htmlEscape(row.name)}: ${row.open_issues} open issue${row.open_issues === 1 ? '' : 's'}${row.high_priority ? `, ${row.high_priority} high priority` : ''}`, '<li>No properties with open issue pressure.</li>')}</ul>
        <h3>Compliance watch</h3>
        <ul>${htmlList(compliance.slice(0, 8), cert => `${htmlEscape(cert.property_name || 'Unknown property')}: ${htmlEscape(cert.cert_type)} expires ${htmlEscape(cert.expiry_date)}`, '<li>No compliance certificates expiring in the next 45 days.</li>')}</ul>
      </div>`;

    const recipients = getTeamRecipients();
    const existing = db.prepare('SELECT id FROM email_agent_reports WHERE report_date = ?').get(date);
    if (existing) {
      db.prepare(`
        UPDATE email_agent_reports
        SET subject = ?, body_text = ?, body_html = ?, recipients_json = ?, status = CASE WHEN status = 'sent' THEN status ELSE 'draft' END, updated_at = CURRENT_TIMESTAMP
        WHERE report_date = ?
      `).run(subject, bodyText, bodyHtml, JSON.stringify(recipients), date);
    } else {
      db.prepare(`
        INSERT INTO email_agent_reports (report_date, subject, body_text, body_html, recipients_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(date, subject, bodyText, bodyHtml, JSON.stringify(recipients));
    }

    return db.prepare('SELECT * FROM email_agent_reports WHERE report_date = ?').get(date);
  } finally {
    db.close();
  }
}

async function sendDailyReport(date = todayKey(), actor = 'admin_email_agent') {
  let report = buildDailyReport(date);
  if (report.status === 'sent') return { success: true, already_sent: true, report };

  const recipients = JSON.parse(report.recipients_json || '[]');
  try {
    await sendGenericEmail({
      to: recipients.join(','),
      subject: report.subject,
      text: report.body_text,
      html: report.body_html,
      fromName: 'FFR Property OS'
    });

    const db = getDb();
    try {
      db.prepare(`
        UPDATE email_agent_reports
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(report.id);
      recordEvent(db, 'email_daily_report_sent', 'operations', date, { actor, recipients });
      report = db.prepare('SELECT * FROM email_agent_reports WHERE id = ?').get(report.id);
    } finally {
      db.close();
    }
    return { success: true, report };
  } catch (error) {
    const db = getDb();
    try {
      db.prepare('UPDATE email_agent_reports SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('failed', error.message, report.id);
    } finally {
      db.close();
    }
    throw error;
  }
}

let reportInterval = null;

async function maybeSendScheduledReport() {
  if (process.env.EMAIL_AGENT_DAILY_REPORT_ENABLED === 'false') return;
  const summary = getSummary();
  if (!summary.admin_account && process.env.EMAIL_AGENT_SEND_EMPTY_REPORTS !== 'true') return;

  const { hour, minute } = getLocalTimeParts();
  const targetHour = Number(process.env.EMAIL_AGENT_REPORT_HOUR || 17);
  const targetMinute = Number(process.env.EMAIL_AGENT_REPORT_MINUTE || 30);
  if (hour < targetHour || (hour === targetHour && minute < targetMinute)) return;

  const date = todayKey();
  const db = getDb();
  try {
    const existing = db.prepare('SELECT status FROM email_agent_reports WHERE report_date = ?').get(date);
    if (existing?.status === 'sent') return;
  } finally {
    db.close();
  }

  try {
    await sendDailyReport(date, 'scheduler');
  } catch (error) {
    console.error('[EmailAgent] Scheduled report failed:', error.message);
  }
}

function startEmailAgentScheduler() {
  if (reportInterval) return;
  reportInterval = setInterval(maybeSendScheduledReport, 15 * 60 * 1000);
  setTimeout(maybeSendScheduledReport, 60 * 1000);
  console.log('[EmailAgent] Daily report scheduler started');
}

function stopEmailAgentScheduler() {
  if (reportInterval) {
    clearInterval(reportInterval);
    reportInterval = null;
  }
}

module.exports = {
  DEFAULT_TEAM_RECIPIENTS,
  getTeamRecipients,
  todayKey,
  classifyEmail,
  recordEmailItem,
  getSummary,
  getItems,
  getDrafts,
  updateDraft,
  approveDraft,
  sendDraft,
  buildDailyReport,
  sendDailyReport,
  startEmailAgentScheduler,
  stopEmailAgentScheduler
};
