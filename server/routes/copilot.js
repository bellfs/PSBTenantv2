const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function buildContext(db) {
  const today = new Date().toISOString().split('T')[0];
  let ctx = `Today's date: ${today}\n\n`;

  // Properties
  const props = db.prepare('SELECT id, name, address, num_units FROM properties ORDER BY name').all();
  ctx += '=== PROPERTIES ===\n';
  ctx += props.map(p => `${p.name} | ${p.address || ''} | ${p.num_units || '?'} units`).join('\n');

  // Tenants with property info
  const tenants = db.prepare(`
    SELECT t.name, t.phone, t.email, t.flat_number, p.name as property_name, t.academic_year, t.active
    FROM tenants t LEFT JOIN properties p ON t.property_id = p.id ORDER BY t.name
  `).all();
  ctx += '\n\n=== TENANTS ===\nName | Phone | Email | Flat | Property | Year | Active\n';
  ctx += tenants.map(t => `${t.name} | ${t.phone || ''} | ${t.email || ''} | ${t.flat_number || ''} | ${t.property_name || ''} | ${t.academic_year || ''} | ${t.active ? 'Yes' : 'No'}`).join('\n');

  // Open issues
  const openIssues = db.prepare(`
    SELECT i.uuid, i.title, i.category, i.status, i.priority, i.estimated_cost, i.final_cost,
      i.attended_by, i.created_at, i.flat_number,
      t.name as tenant_name, p.name as property_name
    FROM issues i
    LEFT JOIN tenants t ON i.tenant_id = t.id
    LEFT JOIN properties p ON i.property_id = p.id
    WHERE i.status NOT IN ('resolved','closed')
    ORDER BY i.created_at DESC
  `).all();
  ctx += '\n\n=== OPEN ISSUES ===\nRef | Title | Tenant | Property | Flat | Category | Priority | Status | Est Cost | Created\n';
  ctx += openIssues.map(i => `${i.uuid} | ${i.title} | ${i.tenant_name || ''} | ${i.property_name || ''} | ${i.flat_number || ''} | ${i.category || ''} | ${i.priority} | ${i.status} | £${i.estimated_cost || 0} | ${i.created_at?.split('T')[0] || ''}`).join('\n');

  // Recent resolved issues (for spending queries)
  const resolved = db.prepare(`
    SELECT i.uuid, i.title, i.category, i.status, i.priority, i.estimated_cost, i.final_cost,
      i.attended_by, i.created_at, i.resolved_at, i.flat_number, i.resolution_notes,
      t.name as tenant_name, p.name as property_name
    FROM issues i
    LEFT JOIN tenants t ON i.tenant_id = t.id
    LEFT JOIN properties p ON i.property_id = p.id
    WHERE i.status IN ('resolved','closed')
    ORDER BY i.resolved_at DESC LIMIT 50
  `).all();
  ctx += '\n\n=== RECENT RESOLVED ISSUES (last 50) ===\nRef | Title | Tenant | Property | Flat | Category | Final Cost | Attended By | Created | Resolved\n';
  ctx += resolved.map(i => `${i.uuid} | ${i.title} | ${i.tenant_name || ''} | ${i.property_name || ''} | ${i.flat_number || ''} | ${i.category || ''} | £${i.final_cost || i.estimated_cost || 0} | ${i.attended_by || ''} | ${i.created_at?.split('T')[0] || ''} | ${i.resolved_at?.split('T')[0] || ''}`).join('\n');

  // Contractors
  const contractors = db.prepare('SELECT name, trade, phone, email, active FROM contractors ORDER BY name').all();
  ctx += '\n\n=== CONTRACTORS ===\nName | Trade | Phone | Email | Active\n';
  ctx += contractors.map(c => `${c.name} | ${c.trade || ''} | ${c.phone || ''} | ${c.email || ''} | ${c.active ? 'Yes' : 'No'}`).join('\n');

  // Spending by property
  const spending = db.prepare(`
    SELECT p.name, COUNT(*) as issue_count,
      COALESCE(SUM(i.estimated_cost),0) as total_estimated,
      COALESCE(SUM(i.final_cost),0) as total_final
    FROM issues i LEFT JOIN properties p ON i.property_id = p.id
    GROUP BY p.name ORDER BY total_final DESC
  `).all();
  ctx += '\n\n=== SPENDING BY PROPERTY ===\nProperty | Issues | Estimated Total | Final Total\n';
  ctx += spending.map(s => `${s.name || 'Unknown'} | ${s.issue_count} | £${s.total_estimated} | £${s.total_final}`).join('\n');

  // Monthly spending last 12 months
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as issues,
      COALESCE(SUM(estimated_cost),0) as estimated, COALESCE(SUM(final_cost),0) as final_cost
    FROM issues
    WHERE created_at >= datetime('now', '-12 months')
    GROUP BY month ORDER BY month DESC
  `).all();
  ctx += '\n\n=== MONTHLY SPENDING (last 12 months) ===\nMonth | Issues | Estimated | Final\n';
  ctx += monthly.map(m => `${m.month} | ${m.issues} | £${m.estimated} | £${m.final_cost}`).join('\n');

  // Utility costs this year
  try {
    const utilities = db.prepare(`
      SELECT property_name, meter_type, COALESCE(SUM(cost),0) as total_cost, COUNT(*) as readings
      FROM meter_readings
      WHERE year >= 2025
      GROUP BY property_name, meter_type
      ORDER BY property_name, meter_type
    `).all();
    ctx += '\n\n=== UTILITY COSTS (2025+) ===\nProperty | Type | Total Cost | Readings\n';
    ctx += utilities.map(u => `${u.property_name} | ${u.meter_type} | £${u.total_cost.toFixed(2)} | ${u.readings}`).join('\n');
  } catch(e) {}

  // Issue stats
  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM issues').get().c,
    open: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'open'").get().c,
    in_progress: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'in_progress'").get().c,
    escalated: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'escalated'").get().c,
    resolved: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'resolved'").get().c,
  };
  ctx += `\n\n=== ISSUE SUMMARY ===\nTotal: ${stats.total} | Open: ${stats.open} | In Progress: ${stats.in_progress} | Escalated: ${stats.escalated} | Resolved: ${stats.resolved}`;

  return ctx;
}

const COPILOT_SYSTEM = `You are the PSB Properties AI copilot, an intelligent assistant for the property management team. You answer questions using the database context provided below.

RULES:
- Answer ONLY from the data provided. If you can't find the answer, say so.
- Be concise and direct. Short answers are better than essays.
- Use GBP (£) for all costs.
- Format names, properties, and figures clearly.
- For tenant lookups, match by first name, last name, or partial name.
- For contractor lookups, match by name or trade.
- When listing items, use simple line breaks, not markdown tables.
- If asked about spending, include both estimated and final costs where available.
- You can do arithmetic on the data (totals, averages, counts).
- Today's date is provided so you can interpret "this week", "last month", etc.
- Be friendly and professional. You're a helpful team assistant.

DATABASE CONTEXT:
`;

router.post('/ask', authenticate, async (req, res) => {
  const { question, history } = req.body;
  if (!question) return res.status(400).json({ error: 'Question required' });

  const db = getDb();
  let context;
  try {
    context = buildContext(db);
  } finally { db.close(); }

  try {
    const { callLLM } = require('../services/llm');
    const messages = [];
    // Include conversation history (last 10 messages)
    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-10)) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: question });

    const answer = await callLLM(messages, {
      systemPrompt: COPILOT_SYSTEM + context,
      maxTokens: 1024,
    });
    res.json({ answer });
  } catch (e) {
    console.error('[Copilot] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
