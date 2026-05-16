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
      open_issues: openIssues,
      tasks,
      approvals,
      email_drafts: emailDrafts,
      intake,
      compliance,
      calendar: {
        connected: calendarAccounts.some(account => account.sync_enabled),
        accounts: calendarAccounts,
        events: calendarEvents
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
