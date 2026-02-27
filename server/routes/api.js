const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { processIncomingMessage } = require('../services/whatsapp');

const router = express.Router();

// ===== PROPERTIES =====
router.get('/properties', authenticate, (req, res) => {
  const db = getDb();
  try {
    res.json(db.prepare(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM tenants WHERE property_id = p.id) as tenant_count,
        (SELECT COUNT(*) FROM issues WHERE property_id = p.id AND status NOT IN ('resolved','closed')) as open_issues,
        (SELECT COUNT(*) FROM issues WHERE property_id = p.id) as total_issues,
        (SELECT COALESCE(SUM(final_cost),0) FROM issues WHERE property_id = p.id AND final_cost IS NOT NULL) as total_spend
      FROM properties p ORDER BY p.name
    `).all());
  } finally { db.close(); }
});

router.get('/properties/:id/issues', authenticate, (req, res) => {
  const db = getDb();
  try {
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
    if (!property) return res.status(404).json({ error: 'Not found' });
    const issues = db.prepare(`
      SELECT i.*, t.name as tenant_name, t.flat_number as tenant_flat,
        (SELECT COUNT(*) FROM messages WHERE issue_id = i.id) as message_count
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id
      WHERE i.property_id = ? ORDER BY i.created_at DESC
    `).all(req.params.id);
    res.json({ property, issues });
  } finally { db.close(); }
});

router.post('/properties', authenticate, requireAdmin, (req, res) => {
  const { name, address, postcode, num_units } = req.body;
  const db = getDb();
  try { res.json({ id: db.prepare('INSERT INTO properties (name, address, postcode, num_units) VALUES (?, ?, ?, ?)').run(name, address, postcode, num_units || 1).lastInsertRowid }); } finally { db.close(); }
});

router.put('/properties/:id', authenticate, requireAdmin, (req, res) => {
  const { name, address, postcode, num_units } = req.body;
  const db = getDb();
  try { db.prepare('UPDATE properties SET name = ?, address = ?, postcode = ?, num_units = ? WHERE id = ?').run(name, address, postcode, num_units, req.params.id); res.json({ success: true }); } finally { db.close(); }
});

// ===== TENANTS =====
router.get('/tenants', authenticate, (req, res) => {
  const db = getDb();
  try {
    res.json(db.prepare(`
      SELECT t.*, p.name as property_name,
        (SELECT COUNT(*) FROM issues WHERE tenant_id = t.id) as total_issues,
        (SELECT COUNT(*) FROM issues WHERE tenant_id = t.id AND status NOT IN ('resolved','closed')) as open_issues,
        (SELECT COALESCE(SUM(final_cost),0) FROM issues WHERE tenant_id = t.id AND final_cost IS NOT NULL) as total_spend
      FROM tenants t LEFT JOIN properties p ON t.property_id = p.id ORDER BY t.name
    `).all());
  } finally { db.close(); }
});

router.get('/tenants/:id/issues', authenticate, (req, res) => {
  const db = getDb();
  try {
    const tenant = db.prepare('SELECT t.*, p.name as property_name FROM tenants t LEFT JOIN properties p ON t.property_id = p.id WHERE t.id = ?').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Not found' });
    const issues = db.prepare(`
      SELECT i.*, p.name as property_name,
        (SELECT COUNT(*) FROM messages WHERE issue_id = i.id) as message_count
      FROM issues i LEFT JOIN properties p ON i.property_id = p.id
      WHERE i.tenant_id = ? ORDER BY i.created_at DESC
    `).all(req.params.id);
    res.json({ tenant, issues });
  } finally { db.close(); }
});

router.put('/tenants/:id', authenticate, (req, res) => {
  const { name, phone, email, property_id, flat_number } = req.body;
  const db = getDb();
  try { db.prepare('UPDATE tenants SET name = ?, phone = ?, email = ?, property_id = ?, flat_number = ? WHERE id = ?').run(name, phone, email, property_id, flat_number, req.params.id); res.json({ success: true }); } finally { db.close(); }
});

// ===== ANALYTICS =====
router.get('/analytics', authenticate, (req, res) => {
  const db = getDb();
  try {
    const data = {
      overview: {
        total_issues: db.prepare('SELECT COUNT(*) as c FROM issues').get().c,
        open: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'open'").get().c,
        in_progress: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'in_progress'").get().c,
        escalated: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'escalated'").get().c,
        resolved: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'resolved'").get().c,
        closed: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'closed'").get().c,
        total_estimated_cost: db.prepare('SELECT COALESCE(SUM(estimated_cost),0) as c FROM issues').get().c,
        total_final_cost: db.prepare('SELECT COALESCE(SUM(final_cost),0) as c FROM issues WHERE final_cost IS NOT NULL').get().c,
        total_estimated_hours: db.prepare('SELECT COALESCE(SUM(estimated_hours),0) as c FROM issues').get().c,
        avg_resolution_hours: db.prepare("SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24) as c FROM issues WHERE resolved_at IS NOT NULL").get().c || 0,
      },
      by_category: db.prepare(`
        SELECT category, COUNT(*) as count, 
          COALESCE(SUM(estimated_cost),0) as est_cost,
          COALESCE(SUM(final_cost),0) as final_cost,
          COALESCE(SUM(estimated_hours),0) as est_hours
        FROM issues WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC
      `).all(),
      by_property: db.prepare(`
        SELECT p.name, COUNT(*) as count,
          COALESCE(SUM(i.estimated_cost),0) as est_cost,
          COALESCE(SUM(i.final_cost),0) as final_cost
        FROM issues i LEFT JOIN properties p ON i.property_id = p.id
        GROUP BY p.name ORDER BY count DESC
      `).all(),
      by_month: db.prepare(`
        SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count,
          COALESCE(SUM(estimated_cost),0) as est_cost,
          COALESCE(SUM(final_cost),0) as final_cost
        FROM issues GROUP BY month ORDER BY month DESC LIMIT 12
      `).all(),
      by_priority: db.prepare(`
        SELECT priority, COUNT(*) as count FROM issues GROUP BY priority
      `).all(),
      by_status: db.prepare(`
        SELECT status, COUNT(*) as count FROM issues GROUP BY status
      `).all(),
      by_attended: db.prepare(`
        SELECT attended_by, COUNT(*) as count,
          COALESCE(SUM(final_cost),0) as total_cost
        FROM issues WHERE attended_by IS NOT NULL AND attended_by != ''
        GROUP BY attended_by ORDER BY count DESC
      `).all(),
      recent_issues: db.prepare(`
        SELECT i.uuid, i.title, i.category, i.status, i.priority, i.estimated_cost, i.final_cost,
          i.estimated_hours, i.attended_by, i.created_at, i.resolved_at,
          t.name as tenant_name, p.name as property_name
        FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN properties p ON i.property_id = p.id
        ORDER BY i.created_at DESC LIMIT 50
      `).all(),
    };
    res.json(data);
  } finally { db.close(); }
});

// Export all issues as CSV
router.get('/analytics/export', authenticate, (req, res) => {
  const db = getDb();
  try {
    const issues = db.prepare(`
      SELECT i.uuid as "Ref", i.title as "Title", i.category as "Category", i.status as "Status",
        i.priority as "Priority", t.name as "Tenant", t.flat_number as "Flat",
        p.name as "Property", i.estimated_cost as "Est. Cost (GBP)", i.estimated_hours as "Est. Hours",
        i.final_cost as "Final Cost (GBP)", i.attended_by as "Attended By",
        i.ai_diagnosis as "AI Diagnosis", i.resolution_notes as "Resolution Notes",
        i.created_at as "Reported", i.resolved_at as "Resolved"
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN properties p ON i.property_id = p.id
      ORDER BY i.created_at DESC
    `).all();

    if (issues.length === 0) return res.status(200).send('No data');
    const headers = Object.keys(issues[0]);
    const csv = [headers.join(','), ...issues.map(r => headers.map(h => {
      const v = r[h] == null ? '' : String(r[h]);
      return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=maintenance-export.csv');
    res.send(csv);
  } finally { db.close(); }
});

// Export property issues
router.get('/properties/:id/export', authenticate, (req, res) => {
  const db = getDb();
  try {
    const issues = db.prepare(`
      SELECT i.uuid as "Ref", i.title as "Title", i.category as "Category", i.status as "Status",
        i.priority as "Priority", t.name as "Tenant", t.flat_number as "Flat",
        i.estimated_cost as "Est. Cost", i.final_cost as "Final Cost", i.attended_by as "Attended By",
        i.resolution_notes as "Resolution Notes", i.created_at as "Reported", i.resolved_at as "Resolved"
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id
      WHERE i.property_id = ? ORDER BY i.created_at DESC
    `).all(req.params.id);
    if (issues.length === 0) return res.status(200).send('No data');
    const headers = Object.keys(issues[0]);
    const csv = [headers.join(','), ...issues.map(r => headers.map(h => { const v = r[h] == null ? '' : String(r[h]); return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v; }).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=property-export.csv');
    res.send(csv);
  } finally { db.close(); }
});

// Export tenant issues
router.get('/tenants/:id/export', authenticate, (req, res) => {
  const db = getDb();
  try {
    const issues = db.prepare(`
      SELECT i.uuid as "Ref", i.title as "Title", i.category as "Category", i.status as "Status",
        i.priority as "Priority", p.name as "Property", i.flat_number as "Flat",
        i.estimated_cost as "Est. Cost", i.final_cost as "Final Cost", i.attended_by as "Attended By",
        i.resolution_notes as "Resolution Notes", i.created_at as "Reported", i.resolved_at as "Resolved"
      FROM issues i LEFT JOIN properties p ON i.property_id = p.id
      WHERE i.tenant_id = ? ORDER BY i.created_at DESC
    `).all(req.params.id);
    if (issues.length === 0) return res.status(200).send('No data');
    const headers = Object.keys(issues[0]);
    const csv = [headers.join(','), ...issues.map(r => headers.map(h => { const v = r[h] == null ? '' : String(r[h]); return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v; }).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=tenant-export.csv');
    res.send(csv);
  } finally { db.close(); }
});

// ===== SETTINGS =====
router.get('/settings', authenticate, requireAdmin, (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
      if (row.key.includes('api_key') && row.value) {
        settings[row.key] = row.value.slice(0, 8) + '...' + row.value.slice(-4);
        settings[row.key + '_set'] = true;
      } else { settings[row.key] = row.value; }
    }
    res.json(settings);
  } finally { db.close(); }
});

router.put('/settings', authenticate, requireAdmin, (req, res) => {
  const db = getDb();
  try {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
    for (const [key, value] of Object.entries(req.body)) {
      if (key.includes('api_key') && typeof value === 'string' && value.includes('...')) continue;
      upsert.run(key, String(value));
    }
    res.json({ success: true });
  } finally { db.close(); }
});

// Staff list (for assignment dropdowns)
router.get('/staff-list', authenticate, (req, res) => {
  const db = getDb();
  try { res.json(db.prepare('SELECT id, name, role FROM staff WHERE active = 1').all()); } finally { db.close(); }
});

// ===== WHATSAPP WEBHOOK =====
router.get('/webhook/whatsapp', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'psb-maintenance-verify';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log(`[WhatsApp] Verification - mode: ${mode}, match: ${token === verifyToken}`); if (mode === 'subscribe' && token === verifyToken) { console.log('[WhatsApp] Webhook verified OK'); res.status(200).send(challenge); }
  else res.status(403).send('Forbidden');
});

router.post('/webhook/whatsapp', (req, res) => {
  // Respond 200 IMMEDIATELY - Meta will retry if it doesn't get this fast
  res.status(200).send('OK');
  const body = req.body;
  console.log('[WhatsApp] Webhook POST received, object:', body?.object, '| entry count:', body?.entry?.length);
  if (!body || body.object !== 'whatsapp_business_account') {
    console.log('[WhatsApp] Ignoring - not a whatsapp_business_account payload');
    return;
  }
  // Process async - do NOT await here, we already sent 200
  processIncomingMessage(body).catch(err => console.error('[Webhook] Processing error:', err.message));
});

// ===== AI ISSUE REPORT =====
router.get('/issues/:id/report', authenticate, async (req, res) => {
  const db = getDb();
  try {
    const issue = db.prepare(`
      SELECT i.*, t.name as tenant_name, t.phone as tenant_phone, t.email as tenant_email, t.flat_number as tenant_flat,
        p.name as property_name, p.address as property_address
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN properties p ON i.property_id = p.id WHERE i.id = ?
    `).get(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Not found' });

    const messages = db.prepare('SELECT * FROM messages WHERE issue_id = ? ORDER BY created_at ASC').all(req.params.id);
    const attachments = db.prepare('SELECT * FROM attachments WHERE issue_id = ?').all(req.params.id);
    const activity = db.prepare('SELECT * FROM activity_log WHERE issue_id = ? ORDER BY created_at DESC').all(req.params.id);

    const conversationText = messages.map(m => {
      const who = m.sender === 'tenant' ? issue.tenant_name : m.sender === 'bot' ? 'AI Bot' : 'Staff';
      const time = new Date(m.created_at).toLocaleString('en-GB');
      return `[${time}] ${who}: ${m.content || '[photo]'}`;
    }).join('\n');

    const { callLLM } = require('../services/llm');
    const reportPrompt = `You are writing a professional maintenance issue report for a property management team. Based on the conversation and data below, write a clear, structured report.

Issue Reference: ${issue.uuid}
Property: ${issue.property_name} (${issue.property_address})
Tenant: ${issue.tenant_name}${issue.tenant_flat ? ', ' + issue.tenant_flat : ''}
Status: ${issue.status}
Priority: ${issue.priority}
Category: ${issue.category || 'Pending'}
Reported: ${new Date(issue.created_at).toLocaleString('en-GB')}
${issue.escalated_at ? 'Escalated: ' + new Date(issue.escalated_at).toLocaleString('en-GB') : ''}
${issue.resolved_at ? 'Resolved: ' + new Date(issue.resolved_at).toLocaleString('en-GB') : ''}
AI Estimated Cost: £${(issue.estimated_cost || 0).toFixed(2)}
AI Estimated Time: ${(issue.estimated_hours || 0).toFixed(1)} hours
${issue.final_cost ? 'Actual Cost: £' + issue.final_cost.toFixed(2) : ''}
${issue.attended_by ? 'Attended By: ' + issue.attended_by : ''}
${issue.resolution_notes ? 'Resolution: ' + issue.resolution_notes : ''}

Photos attached: ${attachments.length}
${attachments.map(a => a.ai_analysis ? 'Photo analysis: ' + a.ai_analysis : '').filter(Boolean).join('\n')}

Full conversation:
${conversationText}

Write the report with these sections:
1) SUMMARY - 2-3 sentence overview of the issue
2) DIAGNOSIS - What the issue is, based on the conversation and any photo analysis
3) ACTIONS TAKEN - What was advised or done
4) RECOMMENDATIONS - What the team should do next (if unresolved)
5) COST ASSESSMENT - Estimated vs actual costs

Keep it professional but concise. No markdown formatting. Use plain text.`;

    const report = await callLLM([{ role: 'user', content: reportPrompt }], { maxTokens: 1500 });

    res.json({
      report,
      issue,
      attachments: attachments.map(a => ({ id: a.id, file_path: a.file_path, file_type: a.file_type, ai_analysis: a.ai_analysis })),
      messages_count: messages.length,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Report] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate report' });
  } finally { db.close(); }
});

// ===== INTERNAL NOTES =====
router.get('/issues/:id/notes', authenticate, (req, res) => {
  const db = getDb();
  try {
    res.json(db.prepare('SELECT * FROM internal_notes WHERE issue_id = ? ORDER BY created_at DESC').all(req.params.id));
  } finally { db.close(); }
});

router.post('/issues/:id/notes', authenticate, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  const db = getDb();
  try {
    const id = db.prepare('INSERT INTO internal_notes (issue_id, content, author) VALUES (?, ?, ?)').run(req.params.id, content, req.user.name).lastInsertRowid;
    db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)').run(req.params.id, 'note_added', 'Internal note added', req.user.name);
    res.json({ id, content, author: req.user.name, created_at: new Date().toISOString() });
  } finally { db.close(); }
});

// ===== RECURRING ISSUES =====
router.get('/issues/:id/similar', authenticate, (req, res) => {
  const db = getDb();
  try {
    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Not found' });
    // Find issues at same property with same category
    const similar = db.prepare(`
      SELECT i.id, i.uuid, i.title, i.category, i.status, i.priority, i.created_at, i.resolved_at,
        t.name as tenant_name, t.flat_number as tenant_flat
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id
      WHERE i.property_id = ? AND i.id != ? AND (i.category = ? OR i.flat_number = ?)
      ORDER BY i.created_at DESC LIMIT 10
    `).all(issue.property_id, issue.id, issue.category, issue.flat_number);
    res.json(similar);
  } finally { db.close(); }
});

// ===== SLA METRICS =====
router.get('/analytics/sla', authenticate, (req, res) => {
  const db = getDb();
  try {
    const data = {
      avg_first_response_mins: db.prepare(`
        SELECT AVG(
          (julianday((SELECT MIN(m.created_at) FROM messages m WHERE m.issue_id = i.id AND m.sender = 'bot')) - julianday(i.created_at)) * 1440
        ) as avg
        FROM issues i WHERE EXISTS (SELECT 1 FROM messages m WHERE m.issue_id = i.id AND m.sender = 'bot')
      `).get()?.avg || 0,
      avg_resolution_hours: db.prepare(`
        SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24) as avg
        FROM issues WHERE resolved_at IS NOT NULL
      `).get()?.avg || 0,
      avg_escalation_hours: db.prepare(`
        SELECT AVG((julianday(escalated_at) - julianday(created_at)) * 24) as avg
        FROM issues WHERE escalated_at IS NOT NULL
      `).get()?.avg || 0,
      issues_resolved_by_ai: db.prepare(`
        SELECT COUNT(*) as c FROM issues WHERE status IN ('resolved','closed')
        AND NOT EXISTS (SELECT 1 FROM messages WHERE issue_id = issues.id AND sender = 'staff')
      `).get()?.c || 0,
      issues_needing_staff: db.prepare(`
        SELECT COUNT(*) as c FROM issues
        WHERE EXISTS (SELECT 1 FROM messages WHERE issue_id = issues.id AND sender = 'staff')
        OR status = 'escalated'
      `).get()?.c || 0,
      total_resolved: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status IN ('resolved','closed')").get()?.c || 0,
      total_escalated: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'escalated'").get()?.c || 0,
      open_over_48h: db.prepare(`
        SELECT COUNT(*) as c FROM issues
        WHERE status IN ('open','in_progress') AND created_at < datetime('now', '-48 hours')
      `).get()?.c || 0,
    };
    res.json(data);
  } finally { db.close(); }
});

module.exports = router;
