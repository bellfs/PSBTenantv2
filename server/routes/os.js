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

module.exports = router;
