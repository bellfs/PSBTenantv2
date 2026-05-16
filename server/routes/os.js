const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const { listAgents } = require('../agents/registry');
const { getCodexVersion } = require('../agents/core/codex-runner');

const router = express.Router();
router.use(authenticate);

function scalar(db, sql, params = [], fallback = 0) {
  try {
    const row = db.prepare(sql).get(...params);
    const value = row && Object.values(row)[0];
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function rows(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch { return []; }
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function laneStatus(score) {
  if (score >= 80) return 'strong';
  if (score >= 55) return 'watch';
  return 'risk';
}

function laneTone(score) {
  if (score >= 80) return 'success';
  if (score >= 55) return 'warning';
  return 'danger';
}

function buildLane({ name, score, owner, agent_key, signals, href }) {
  const safeScore = clamp(score);
  return {
    name,
    score: safeScore,
    status: laneStatus(safeScore),
    tone: laneTone(safeScore),
    owner,
    agent_key,
    href,
    signals: signals.filter(Boolean).slice(0, 3)
  };
}

function buildLaneHealth({ issueCounts, taskCounts, emailCounts, approvalCounts, complianceCounts, intakeCounts, calendarConnected, memoryFresh, financeUncategorised }) {
  return [
    buildLane({
      name: 'Inbox & Admin',
      score: 100 - (emailCounts.needs_reply * 7) - (emailCounts.draft_replies * 4) - (emailCounts.needs_followup * 5),
      owner: 'Hannah',
      agent_key: 'admin_email_agent',
      href: '/email-agent',
      signals: [
        `${emailCounts.needs_reply} emails need reply`,
        `${emailCounts.draft_replies} drafts waiting`,
        emailCounts.needs_followup ? `${emailCounts.needs_followup} team follow-ups` : 'No team follow-ups flagged'
      ]
    }),
    buildLane({
      name: 'Maintenance & Turnaround',
      score: 100 - (issueCounts.urgent * 16) - (issueCounts.escalated * 18) - Math.min(issueCounts.open, 20) * 2 - (taskCounts.due_today * 5),
      owner: 'Andy / Akiel',
      agent_key: issueCounts.urgent || issueCounts.escalated ? 'maintenance_triage' : 'turnaround_orchestrator',
      href: '/issues',
      signals: [
        `${issueCounts.open} open issues`,
        `${issueCounts.urgent} urgent`,
        `${taskCounts.due_today} tasks due today`
      ]
    }),
    buildLane({
      name: 'Compliance & Legal Risk',
      score: 100 - (complianceCounts.expired * 22) - (complianceCounts.expiring_soon * 7) - (approvalCounts.high_risk * 8),
      owner: 'Fergus / Hannah',
      agent_key: 'compliance_guardian',
      href: '/compliance',
      signals: [
        `${complianceCounts.expired} expired items`,
        `${complianceCounts.expiring_soon} expiring soon`,
        approvalCounts.high_risk ? `${approvalCounts.high_risk} high-risk approvals` : 'No high-risk approvals'
      ]
    }),
    buildLane({
      name: 'Lettings & Revenue',
      score: 86 - (intakeCounts.extracted_tasks * 2) - (taskCounts.due_soon * 2),
      owner: 'Hannah / Fergus',
      agent_key: 'leasing_revenue',
      href: '/agents',
      signals: [
        `${intakeCounts.extracted_tasks} extracted intake tasks`,
        `${taskCounts.due_soon} tasks due this week`,
        'Protect 52OE pricing and short-let calendar discipline'
      ]
    }),
    buildLane({
      name: 'Finance & Suppliers',
      score: 88 - Math.min(financeUncategorised, 30) - (approvalCounts.pending * 2),
      owner: 'Fergus / Hannah',
      agent_key: financeUncategorised ? 'finance_reconciler' : 'utilities_procurement',
      href: '/finance',
      signals: [
        `${financeUncategorised} uncategorised transactions`,
        `${approvalCounts.pending} approvals pending`,
        'Keep supplier evidence and meter readings source-linked'
      ]
    }),
    buildLane({
      name: 'Memory & Calendar',
      score: 55 + (calendarConnected ? 20 : 0) + (memoryFresh ? 25 : 0),
      owner: 'System',
      agent_key: 'ops_copilot',
      href: '/business-memory',
      signals: [
        calendarConnected ? 'Calendar connected' : 'Calendar not connected',
        memoryFresh ? 'Business Memory refreshed today' : 'Business Memory needs refresh',
        'Ledger is the future source of record'
      ]
    })
  ];
}

function buildNextActions({ issueCounts, taskCounts, emailCounts, approvalCounts, complianceCounts, intakeCounts, calendarConnected, memoryFresh }) {
  const actions = [];
  if (emailCounts.needs_reply || emailCounts.draft_replies) {
    actions.push({
      title: 'Clear email replies before new work starts',
      detail: `${emailCounts.needs_reply} need reply and ${emailCounts.draft_replies} drafts are waiting.`,
      href: '/email-agent',
      action: 'Run email agent',
      agent_key: 'admin_email_agent',
      prompt: 'Review today\'s connected inbox context, identify emails needing replies, draft any missing replies, and produce a short admin action list with owners.'
    });
  }
  if (approvalCounts.pending) {
    actions.push({
      title: 'Review approval queue',
      detail: `${approvalCounts.pending} decisions are waiting; ${approvalCounts.high_risk} are high risk.`,
      href: '/agents',
      action: 'Open approvals',
      agent_key: 'ops_copilot',
      prompt: 'Review pending approvals, group them by risk, and recommend the safest review order with source evidence required for each.'
    });
  }
  if (issueCounts.urgent || issueCounts.escalated) {
    actions.push({
      title: 'Triage urgent maintenance',
      detail: `${issueCounts.urgent} urgent and ${issueCounts.escalated} escalated issues need same-day handling.`,
      href: '/issues',
      action: 'Run triage',
      agent_key: 'maintenance_triage',
      prompt: 'Review urgent and escalated maintenance issues, identify safety risks, missing information, owner, next action, and approval requirements.'
    });
  }
  if (complianceCounts.expired || complianceCounts.expiring_soon) {
    actions.push({
      title: 'Protect compliance position',
      detail: `${complianceCounts.expired} expired and ${complianceCounts.expiring_soon} expiring items are visible.`,
      href: '/compliance',
      action: 'Run guardian',
      agent_key: 'compliance_guardian',
      prompt: 'Review compliance items due or expired, rank by property risk, and draft the evidence checklist needed to close gaps.'
    });
  }
  if (taskCounts.due_today) {
    actions.push({
      title: 'Close today\'s task commitments',
      detail: `${taskCounts.due_today} open tasks are due today.`,
      href: '/agents',
      action: 'Plan day',
      agent_key: 'ops_copilot',
      prompt: 'Turn today\'s due tasks into a clear operating plan with owner, deadline, source, and decision needed.'
    });
  }
  if (intakeCounts.extracted_tasks) {
    actions.push({
      title: 'Convert intake into accountable work',
      detail: `${intakeCounts.extracted_tasks} WhatsApp/email intake tasks have been extracted.`,
      href: '/intake',
      action: 'Review intake',
      agent_key: 'turnaround_orchestrator',
      prompt: 'Review recent intake extractions and consolidate duplicate or unclear jobs into a prioritised task list with property, owner, due date and approval risks.'
    });
  }
  if (!calendarConnected) {
    actions.push({
      title: 'Connect shared calendar',
      detail: 'Calendar is not yet connected, so viewings, cleans and short-let commitments are not fully visible.',
      href: '/',
      action: 'Connect calendar',
      agent_key: null
    });
  }
  if (!memoryFresh) {
    actions.push({
      title: 'Refresh Business Memory',
      detail: 'Run a snapshot so agents read the latest database, calendar, email and curated FFR context.',
      href: '/business-memory',
      action: 'Refresh memory',
      agent_key: null
    });
  }
  if (!actions.length) {
    actions.push({
      title: 'Run a daily ops sweep',
      detail: 'No critical blockers are visible. Use the spare capacity to find weak signals before they become problems.',
      href: '/agents',
      action: 'Run sweep',
      agent_key: 'ops_copilot',
      prompt: 'Run a daily FFR Property OS sweep across memory, issues, email, calendar, tasks and approvals. Identify weak signals, missing data and the next three useful actions.'
    });
  }
  return actions.slice(0, 5);
}

function buildAgentSuggestions(nextActions) {
  return nextActions
    .filter(action => action.agent_key)
    .slice(0, 3)
    .map(action => ({
      agent_key: action.agent_key,
      title: action.action,
      request: action.prompt,
      why: action.detail,
      source: 'today_command_center'
    }));
}

function buildCommandBrief({ issueCounts, taskCounts, emailCounts, approvalCounts, complianceCounts, calendarConnected, memoryFresh }) {
  const blockers = [];
  if (issueCounts.urgent || issueCounts.escalated) blockers.push('urgent maintenance');
  if (approvalCounts.pending) blockers.push('pending approvals');
  if (emailCounts.needs_reply || emailCounts.draft_replies) blockers.push('email replies');
  if (complianceCounts.expired) blockers.push('expired compliance');

  const headline = blockers.length
    ? `Start with ${blockers.slice(0, 2).join(' and ')}.`
    : 'No critical blockers visible. Use today to tighten the system.';

  const summary = [
    `${issueCounts.open} open issues, ${taskCounts.open} open agent tasks and ${approvalCounts.pending} pending approvals are visible.`,
    `${emailCounts.needs_reply} emails need reply and ${emailCounts.draft_replies} draft replies are waiting.`,
    calendarConnected ? 'Calendar context is connected.' : 'Calendar context is not connected yet.',
    memoryFresh ? 'Business Memory has been refreshed today.' : 'Business Memory has not been refreshed today.'
  ];

  return {
    headline,
    summary,
    operating_mode: approvalCounts.high_risk || issueCounts.urgent || complianceCounts.expired ? 'Human-in-the-loop' : 'Copilot',
    principle: 'Decide once, record it, and let agents reuse the context next time.'
  };
}

function buildAutonomyStatus({ emailAccounts, calendarConnected, memoryFresh, ledgerEvents, approvalCounts }) {
  const score = clamp(
    35 +
    (emailAccounts ? 15 : 0) +
    (calendarConnected ? 15 : 0) +
    (memoryFresh ? 15 : 0) +
    (ledgerEvents ? 10 : 0) -
    Math.min(approvalCounts.pending * 2, 20)
  );

  return {
    score,
    status: laneStatus(score),
    mode: process.env.CODEX_AGENT_MODE === 'execute' ? 'execute' : 'dry_run',
    explanation: score >= 80
      ? 'The platform has enough connected context to let agents take more first drafts and monitoring work.'
      : score >= 55
      ? 'The control plane is usable, but more calendar/email/memory coverage will improve autonomy.'
      : 'The platform needs more connected source systems before agents can safely reduce human load.',
    gaps: [
      emailAccounts ? null : 'Connect the core team inboxes.',
      calendarConnected ? null : 'Connect shared Google Calendar.',
      memoryFresh ? null : 'Refresh Business Memory today.',
      ledgerEvents ? null : 'Generate more source-of-record ledger events.'
    ].filter(Boolean)
  };
}

function buildSeniorReview({ modules, taskSummary, codexVersion }) {
  return {
    verdict: 'The platform has the right foundations. The next leap is not more pages; it is a tighter operating loop that turns every email, WhatsApp, calendar event and document into decisions, tasks, approvals and memory.',
    simplifications: [
      'Make Today the default cockpit for the team, not a passive dashboard.',
      'Keep specialist modules, but hide them behind operating lanes and next actions.',
      'Move from raw inbox/chat lists to decisions, owners, dates and evidence.',
      'Use Business Memory as the agent-readable company wiki rather than scattering context across prompts.'
    ],
    feature_priorities: [
      { horizon: 'Now', title: 'Command center', detail: 'Daily brief, lane health, decision queue and suggested agent runs on the first screen.' },
      { horizon: 'Now', title: 'Approval discipline', detail: 'External messages, pricing, spend, legal, access and supplier changes stay human-approved.' },
      { horizon: 'Next', title: 'Leasing pipeline', detail: 'Lead, viewing, offer, contract, deposit and renewal state should become a first-class data model.' },
      { horizon: 'Next', title: 'Short-let control room', detail: 'Calendar, OTA listing, cleaner, linen, access and revenue targets need one operating lane.' },
      { horizon: 'Later', title: 'Autonomous playbooks', detail: 'Only promote workflows from draft to execute after they have repeated, logged success.' }
    ],
    operating_principles: [
      'Every action has an owner, source, deadline and approval state.',
      'Agents draft and monitor by default; humans approve commitments.',
      'The database and ledger are the source of record; curated memory is the shared operating brain.',
      'The team sees fewer screens, while agents see more context.'
    ],
    current_constraints: [
      codexVersion ? null : 'Codex live execution is not available in this server process; agent runs will remain dry-run/prompt-prep until configured.',
      taskSummary.pending_approvals ? `${taskSummary.pending_approvals} approvals need human review before autonomy can increase.` : null,
      modules.find(module => module.key === 'finance')?.status === 'partial' ? 'Finance is still partial; bank/Pleo/QuickBooks coverage should be expanded before autonomous finance workflows.' : null
    ].filter(Boolean)
  };
}

router.get('/overview', async (req, res) => {
  const db = getDb();
  try {
    const codexVersion = await getCodexVersion();
    const agents = listAgents();

    const modules = [
      {
        key: 'portfolio',
        name: 'Portfolio',
        count: scalar(db, 'SELECT COUNT(*) FROM properties'),
        status: 'live',
        detail: 'Properties, units, addresses, budgets, tenants and property-level issue history.'
      },
      {
        key: 'tenants',
        name: 'Tenants & Tenancies',
        count: scalar(db, 'SELECT COUNT(*) FROM tenants'),
        status: 'live',
        detail: 'Current tenant directory, tenancy records, rent fields and academic-year structure.'
      },
      {
        key: 'maintenance',
        name: 'Maintenance',
        count: scalar(db, "SELECT COUNT(*) FROM issues WHERE status NOT IN ('resolved','closed')"),
        status: 'live',
        detail: 'WhatsApp issue intake, AI triage, issue timeline, contractors, quotes and repair evidence.'
      },
      {
        key: 'compliance',
        name: 'Compliance',
        count: scalar(db, 'SELECT COUNT(*) FROM compliance_certificates'),
        status: 'live',
        detail: 'Certificates, documents, expiry dates, missing coverage and audit evidence.'
      },
      {
        key: 'utilities',
        name: 'Utilities',
        count: scalar(db, 'SELECT COUNT(*) FROM meter_readings'),
        status: 'live',
        detail: 'Meter readings, rates, usage alerts, fair usage and supplier cost analysis.'
      },
      {
        key: 'finance',
        name: 'Finance',
        count: scalar(db, 'SELECT COUNT(*) FROM bank_transactions'),
        status: 'partial',
        detail: 'Bank connections, transaction categorisation, property tagging and P&L foundations.'
      },
      {
        key: 'agents',
        name: 'Agents',
        count: agents.length,
        status: codexVersion ? 'codex-ready' : 'codex-missing',
        detail: 'Codex-backed agent registry, dry-run execution, tasks, approvals and event logs.'
      }
    ];

    const riskSignals = [
      {
        title: 'WhatsApp is acting as an operating system',
        severity: 'high',
        detail: 'Job lists, access notes, contractor updates and priority decisions are spread across chat. FFR OS should convert those into tasks, events and approvals.'
      },
      {
        title: 'Priorities shift under time pressure',
        severity: 'high',
        detail: 'The summer turnaround and 52 Old Elvet works need visible trade-offs: deadline, compliance, tenant impact, cost and contractor availability.'
      },
      {
        title: 'Commercial decisions need one source of truth',
        severity: 'medium',
        detail: 'Leads, viewings, contracts, deposits, pricing and short-let availability should sit in one leasing/revenue lane.'
      },
      {
        title: 'Supplier and utility contracts need evidence discipline',
        severity: 'high',
        detail: 'Energy, broadband, Guesty/OTA and contractor disputes need source documents, timeline evidence and approval-controlled responses.'
      },
      {
        title: 'Legal/compliance replies need guardrails',
        severity: 'high',
        detail: 'Rent, deposits, access, fire safety, HMO and Renters Rights Bill-sensitive messages should be drafted by agents but approved by humans.'
      }
    ];

    const taskSummary = {
      open: scalar(db, "SELECT COUNT(*) FROM agent_tasks WHERE status = 'open'"),
      urgent: scalar(db, "SELECT COUNT(*) FROM agent_tasks WHERE status = 'open' AND priority = 'urgent'"),
      due_soon: scalar(db, "SELECT COUNT(*) FROM agent_tasks WHERE status = 'open' AND due_date IS NOT NULL AND due_date <= date('now', '+7 days')"),
      pending_approvals: scalar(db, "SELECT COUNT(*) FROM agent_approvals WHERE status = 'pending'")
    };

    const recentEvents = rows(db, `
      SELECT * FROM agent_events
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const lanes = [
      { name: 'Lettings & Revenue', agents: ['leasing_revenue', 'short_let_operator'], next: 'Lead/viewing/reservation tables and enquiry import.' },
      { name: 'Tenant Ops & Maintenance', agents: ['maintenance_triage', 'turnaround_orchestrator'], next: 'Convert chat/job lists into tasks with property, owner and due date.' },
      { name: 'Compliance & Risk', agents: ['compliance_guardian'], next: 'Expand certificate requirements into a per-property compliance matrix.' },
      { name: 'Money & Suppliers', agents: ['finance_reconciler', 'utilities_procurement', 'contractor_value'], next: 'Invoice and supplier-document intake with approval workflow.' },
      { name: 'Growth & Capital', agents: ['development_deals'], next: 'Deals, capex, planning, lender and investor data model.' }
    ];

    res.json({
      name: 'FFR Property OS',
      subtitle: 'A consolidated agentic operating layer for PSB, PSB52 and FFR Group property operations.',
      codex: {
        available: !!codexVersion,
        version: codexVersion,
        mode: process.env.CODEX_AGENT_MODE === 'execute' ? 'execute' : 'dry_run',
        sandbox: process.env.CODEX_AGENT_SANDBOX || 'read-only'
      },
      modules,
      risk_signals: riskSignals,
      senior_review: buildSeniorReview({ modules, taskSummary, codexVersion }),
      task_summary: taskSummary,
      lanes,
      recent_events: recentEvents
    });
  } finally { db.close(); }
});

router.get('/today', (req, res) => {
  const db = getDb();
  try {
    const issueCounts = {
      open: scalar(db, "SELECT COUNT(*) FROM issues WHERE status NOT IN ('resolved','closed')"),
      urgent: scalar(db, "SELECT COUNT(*) FROM issues WHERE status NOT IN ('resolved','closed') AND priority = 'urgent'"),
      escalated: scalar(db, "SELECT COUNT(*) FROM issues WHERE status = 'escalated'"),
      today: scalar(db, "SELECT COUNT(*) FROM issues WHERE DATE(created_at) = DATE('now')")
    };

    const taskCounts = {
      open: scalar(db, "SELECT COUNT(*) FROM agent_tasks WHERE status = 'open'"),
      urgent: scalar(db, "SELECT COUNT(*) FROM agent_tasks WHERE status = 'open' AND priority = 'urgent'"),
      due_today: scalar(db, "SELECT COUNT(*) FROM agent_tasks WHERE status = 'open' AND due_date IS NOT NULL AND due_date <= DATE('now')"),
      due_soon: scalar(db, "SELECT COUNT(*) FROM agent_tasks WHERE status = 'open' AND due_date IS NOT NULL AND due_date <= DATE('now', '+7 days')")
    };

    const emailCounts = {
      needs_reply: scalar(db, 'SELECT COUNT(*) FROM email_agent_items WHERE needs_reply = 1'),
      needs_followup: scalar(db, 'SELECT COUNT(*) FROM email_agent_items WHERE needs_team_followup = 1'),
      draft_replies: scalar(db, "SELECT COUNT(*) FROM email_agent_drafts WHERE status = 'draft'"),
      today: scalar(db, "SELECT COUNT(*) FROM email_agent_items WHERE DATE(created_at) = DATE('now')")
    };

    const approvalCounts = {
      pending: scalar(db, "SELECT COUNT(*) FROM agent_approvals WHERE status = 'pending'"),
      high_risk: scalar(db, "SELECT COUNT(*) FROM agent_approvals WHERE status = 'pending' AND risk_level = 'high'")
    };

    const complianceCounts = {
      expired: scalar(db, "SELECT COUNT(*) FROM compliance_certificates WHERE expiry_date < DATE('now')"),
      expiring_soon: scalar(db, "SELECT COUNT(*) FROM compliance_certificates WHERE expiry_date >= DATE('now') AND expiry_date <= DATE('now', '+30 days')")
    };

    const intakeCounts = {
      messages: scalar(db, 'SELECT COUNT(*) FROM intake_items'),
      extracted_tasks: scalar(db, "SELECT COUNT(*) FROM intake_extractions WHERE extraction_type IN ('task','task_with_approval')"),
      today: scalar(db, "SELECT COUNT(*) FROM intake_items WHERE DATE(created_at) = DATE('now')")
    };

    const calendarAccounts = rows(db, `
      SELECT id, provider, email_address, calendar_id, last_sync_at, sync_enabled
      FROM calendar_accounts
      ORDER BY created_at DESC
    `);

    const calendarEvents = rows(db, `
      SELECT ce.*, ca.email_address as account_email
      FROM calendar_events ce
      LEFT JOIN calendar_accounts ca ON ca.id = ce.calendar_account_id
      WHERE ce.start_at IS NULL OR ce.start_at >= datetime('now', '-2 hours')
      ORDER BY COALESCE(ce.start_at, ce.updated_at) ASC
      LIMIT 8
    `);

    const openIssues = rows(db, `
      SELECT i.id, i.uuid, i.title, i.status, i.priority, i.created_at, i.updated_at,
        p.name as property_name, t.name as tenant_name
      FROM issues i
      LEFT JOIN properties p ON p.id = i.property_id
      LEFT JOIN tenants t ON t.id = i.tenant_id
      WHERE i.status NOT IN ('resolved','closed')
      ORDER BY
        CASE i.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        i.updated_at DESC,
        i.created_at DESC
      LIMIT 8
    `);

    const tasks = rows(db, `
      SELECT t.*, p.name as property_name, tenant.name as tenant_name
      FROM agent_tasks t
      LEFT JOIN properties p ON p.id = t.property_id
      LEFT JOIN tenants tenant ON tenant.id = t.tenant_id
      WHERE t.status = 'open'
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        COALESCE(t.due_date, '9999-12-31') ASC,
        t.created_at DESC
      LIMIT 8
    `);

    const approvals = rows(db, `
      SELECT a.*, t.title as task_title, r.agent_name
      FROM agent_approvals a
      LEFT JOIN agent_tasks t ON t.id = a.task_id
      LEFT JOIN agent_runs r ON r.id = a.agent_run_id
      WHERE a.status = 'pending'
      ORDER BY CASE a.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, a.created_at DESC
      LIMIT 6
    `);

    const emailDrafts = rows(db, `
      SELECT d.id, d.to_address, d.subject, d.created_at, ei.priority, ei.summary, ei.domain
      FROM email_agent_drafts d
      LEFT JOIN email_agent_items ei ON ei.id = d.email_agent_item_id
      WHERE d.status = 'draft'
      ORDER BY d.created_at DESC
      LIMIT 6
    `);

    const intake = rows(db, `
      SELECT e.id, e.title, e.summary, e.domain, e.priority, e.agent_key, i.sender, i.source_name, i.occurred_at
      FROM intake_extractions e
      LEFT JOIN intake_items i ON i.id = e.intake_item_id
      ORDER BY e.created_at DESC
      LIMIT 6
    `);

    const compliance = rows(db, `
      SELECT c.id, c.cert_type, c.expiry_date, p.name as property_name
      FROM compliance_certificates c
      LEFT JOIN properties p ON p.id = c.property_id
      WHERE c.expiry_date <= DATE('now', '+60 days')
      ORDER BY c.expiry_date ASC
      LIMIT 8
    `);

    const propertyPulse = rows(db, `
      SELECT p.id, p.name, p.address,
        COUNT(i.id) as open_issues,
        SUM(CASE WHEN i.priority IN ('urgent','high') THEN 1 ELSE 0 END) as high_priority
      FROM properties p
      LEFT JOIN issues i ON i.property_id = p.id AND i.status NOT IN ('resolved','closed')
      GROUP BY p.id
      ORDER BY high_priority DESC, open_issues DESC, p.name COLLATE NOCASE
      LIMIT 8
    `);

    const emailAccountCount = scalar(db, 'SELECT COUNT(*) FROM email_accounts WHERE sync_enabled = 1');
    const memoryFresh = !!scalar(db, "SELECT COUNT(*) FROM business_memory_snapshots WHERE status = 'completed' AND DATE(created_at) = DATE('now')");
    const latestMemorySnapshot = rows(db, `
      SELECT id, root_path, file_count, bytes_written, status, created_by, created_at
      FROM business_memory_snapshots
      ORDER BY created_at DESC
      LIMIT 1
    `)[0] || null;
    const ledgerEventsToday = scalar(db, "SELECT COUNT(*) FROM business_event_ledger WHERE DATE(created_at) = DATE('now')");
    const ledgerEventsTotal = scalar(db, 'SELECT COUNT(*) FROM business_event_ledger');
    const financeUncategorised = scalar(db, `
      SELECT COUNT(*)
      FROM bank_transactions
      WHERE COALESCE(ai_category, category, '') = ''
         OR LOWER(COALESCE(ai_category, category, '')) LIKE '%uncategor%'
         OR LOWER(COALESCE(ai_category, category, '')) LIKE '%other%'
    `);
    const calendarConnected = calendarAccounts.some(account => account.sync_enabled);
    const laneHealth = buildLaneHealth({
      issueCounts,
      taskCounts,
      emailCounts,
      approvalCounts,
      complianceCounts,
      intakeCounts,
      calendarConnected,
      memoryFresh,
      financeUncategorised
    });
    const nextActions = buildNextActions({
      issueCounts,
      taskCounts,
      emailCounts,
      approvalCounts,
      complianceCounts,
      intakeCounts,
      calendarConnected,
      memoryFresh
    });
    const commandBrief = buildCommandBrief({
      issueCounts,
      taskCounts,
      emailCounts,
      approvalCounts,
      complianceCounts,
      calendarConnected,
      memoryFresh
    });
    const autonomy = buildAutonomyStatus({
      emailAccounts: emailAccountCount,
      calendarConnected,
      memoryFresh,
      ledgerEvents: ledgerEventsTotal,
      approvalCounts
    });

    const focus = [];
    if (issueCounts.urgent || issueCounts.escalated) {
      focus.push({
        tone: 'danger',
        title: 'Urgent maintenance',
        detail: `${issueCounts.urgent} urgent, ${issueCounts.escalated} escalated`,
        href: '/issues'
      });
    }
    if (emailCounts.draft_replies || emailCounts.needs_reply) {
      focus.push({
        tone: 'info',
        title: 'Email replies',
        detail: `${emailCounts.draft_replies} draft replies, ${emailCounts.needs_reply} messages need reply`,
        href: '/email-agent'
      });
    }
    if (approvalCounts.pending) {
      focus.push({
        tone: approvalCounts.high_risk ? 'danger' : 'warning',
        title: 'Approvals',
        detail: `${approvalCounts.pending} pending, ${approvalCounts.high_risk} high risk`,
        href: '/agents'
      });
    }
    if (taskCounts.due_today || taskCounts.due_soon) {
      focus.push({
        tone: taskCounts.due_today ? 'warning' : 'info',
        title: 'Tasks due',
        detail: `${taskCounts.due_today} due today, ${taskCounts.due_soon} due within 7 days`,
        href: '/agents'
      });
    }
    if (complianceCounts.expired || complianceCounts.expiring_soon) {
      focus.push({
        tone: complianceCounts.expired ? 'danger' : 'warning',
        title: 'Compliance',
        detail: `${complianceCounts.expired} expired, ${complianceCounts.expiring_soon} expiring soon`,
        href: '/compliance'
      });
    }

    res.json({
      date: new Date().toISOString(),
      user: req.user || null,
      counts: {
        issues: issueCounts,
        tasks: taskCounts,
        email: emailCounts,
        approvals: approvalCounts,
        compliance: complianceCounts,
        intake: intakeCounts
      },
      focus,
      command_brief: commandBrief,
      next_actions: nextActions,
      lane_health: laneHealth,
      agent_suggestions: buildAgentSuggestions(nextActions),
      autonomy,
      open_issues: openIssues,
      tasks,
      approvals,
      email_drafts: emailDrafts,
      intake,
      compliance,
      calendar: {
        connected: calendarConnected,
        accounts: calendarAccounts,
        events: calendarEvents
      },
      memory: {
        fresh_today: memoryFresh,
        latest_snapshot: latestMemorySnapshot,
        ledger_events_today: ledgerEventsToday,
        ledger_events_total: ledgerEventsTotal
      },
      property_pulse: propertyPulse,
      desktop_notifications: {
        critical_count: issueCounts.urgent + issueCounts.escalated + approvalCounts.high_risk + complianceCounts.expired,
        reminder_count: taskCounts.due_today + emailCounts.draft_replies + complianceCounts.expiring_soon
      }
    });
  } finally { db.close(); }
});

module.exports = router;
