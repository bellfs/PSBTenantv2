const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const { sendStaffResponse, sendStatusUpdate } = require('../services/whatsapp');
const { actorFromUser, recordBusinessEvent, recordEntityChange } = require('../services/business-ledger');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const { status, priority, property_id, search, page = 1, limit = 20 } = req.query;
  const db = getDb();
  try {
    let where = ['1=1'], params = [];
    if (status && status !== 'all') { where.push('i.status = ?'); params.push(status); }
    if (priority && priority !== 'all') { where.push('i.priority = ?'); params.push(priority); }
    if (property_id && property_id !== 'all') { where.push('i.property_id = ?'); params.push(property_id); }
    if (search) { where.push('(i.title LIKE ? OR i.description LIKE ? OR t.name LIKE ? OR i.uuid LIKE ?)'); const s = `%${search}%`; params.push(s,s,s,s); }
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { total } = db.prepare(`SELECT COUNT(*) as total FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id WHERE ${where.join(' AND ')}`).get(...params);
    const issues = db.prepare(`
      SELECT i.*, t.name as tenant_name, t.phone as tenant_phone, t.flat_number as tenant_flat,
        p.name as property_name, p.address as property_address,
        (SELECT COUNT(*) FROM messages WHERE issue_id = i.id) as message_count,
        (SELECT COUNT(*) FROM attachments WHERE issue_id = i.id) as photo_count,
        (SELECT content FROM messages WHERE issue_id = i.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN properties p ON i.property_id = p.id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, i.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);
    res.json({ issues, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) } });
  } finally { db.close(); }
});

router.get('/timeline', authenticate, (req, res) => {
  const db = getDb();
  try {
    const issues = db.prepare(`
      SELECT i.id, i.uuid, i.title, i.status, i.priority, i.category,
        i.created_at, i.escalated_at, i.resolved_at, i.updated_at,
        i.ai_diagnosis, i.estimated_cost, i.flat_number,
        t.name as tenant_name, p.name as property_name
      FROM issues i
      LEFT JOIN tenants t ON i.tenant_id = t.id
      LEFT JOIN properties p ON i.property_id = p.id
      ORDER BY i.created_at DESC
    `).all();
    res.json({ issues });
  } finally { db.close(); }
});

router.get('/stats', authenticate, (req, res) => {
  const db = getDb();
  try {
    res.json({
      total: db.prepare('SELECT COUNT(*) as c FROM issues').get().c,
      open: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'open'").get().c,
      in_progress: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'in_progress'").get().c,
      escalated: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'escalated'").get().c,
      resolved: db.prepare("SELECT COUNT(*) as c FROM issues WHERE status = 'resolved'").get().c,
      urgent: db.prepare("SELECT COUNT(*) as c FROM issues WHERE priority = 'urgent' AND status NOT IN ('resolved','closed')").get().c,
      today: db.prepare("SELECT COUNT(*) as c FROM issues WHERE date(created_at) = date('now')").get().c,
      this_week: db.prepare("SELECT COUNT(*) as c FROM issues WHERE created_at >= datetime('now', '-7 days')").get().c,
      total_estimated_cost: db.prepare('SELECT COALESCE(SUM(estimated_cost),0) as c FROM issues').get().c,
      total_final_cost: db.prepare('SELECT COALESCE(SUM(final_cost),0) as c FROM issues WHERE final_cost IS NOT NULL').get().c,
      by_category: db.prepare("SELECT category, COUNT(*) as count FROM issues WHERE status NOT IN ('resolved','closed') AND category IS NOT NULL GROUP BY category ORDER BY count DESC").all(),
      by_property: db.prepare("SELECT p.name, COUNT(*) as count FROM issues i LEFT JOIN properties p ON i.property_id = p.id WHERE i.status NOT IN ('resolved','closed') GROUP BY p.name ORDER BY count DESC").all(),
      recent_escalations: db.prepare("SELECT i.*, t.name as tenant_name, p.name as property_name FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN properties p ON i.property_id = p.id WHERE i.status = 'escalated' ORDER BY i.escalated_at DESC LIMIT 5").all(),
      recent_issues: db.prepare(`
        SELECT i.id, i.uuid, i.title, i.status, i.priority, i.category, i.created_at,
          t.name as tenant_name, p.name as property_name,
          (SELECT file_path FROM attachments WHERE issue_id = i.id LIMIT 1) as thumbnail
        FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN properties p ON i.property_id = p.id
        ORDER BY i.created_at DESC LIMIT 8
      `).all(),
      top_complainers: db.prepare(`
        SELECT t.id, t.name as tenant_name, t.flat_number, p.name as property_name,
          COUNT(*) as issue_count,
          SUM(CASE WHEN i.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as open_count,
          MAX(i.created_at) as last_issue_at
        FROM issues i
        LEFT JOIN tenants t ON i.tenant_id = t.id
        LEFT JOIN properties p ON i.property_id = p.id
        WHERE t.id IS NOT NULL
        GROUP BY t.id
        ORDER BY issue_count DESC
        LIMIT 10
      `).all()
    });
  } finally { db.close(); }
});

router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  try {
    const issue = db.prepare(`
      SELECT i.*, t.name as tenant_name, t.phone as tenant_phone, t.email as tenant_email, t.flat_number as tenant_flat, t.id as tenant_id_ref,
        p.name as property_name, p.address as property_address
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN properties p ON i.property_id = p.id WHERE i.id = ?
    `).get(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Not found' });
    const messages = db.prepare('SELECT * FROM messages WHERE issue_id = ? ORDER BY created_at ASC').all(req.params.id);
    const attachments = db.prepare('SELECT * FROM attachments WHERE issue_id = ?').all(req.params.id);
    const activity = db.prepare('SELECT * FROM activity_log WHERE issue_id = ? ORDER BY created_at DESC').all(req.params.id);
    const staff = db.prepare('SELECT id, name FROM staff WHERE active = 1').all();
    let notes = [];
    try { notes = db.prepare('SELECT * FROM internal_notes WHERE issue_id = ? ORDER BY created_at DESC').all(req.params.id); } catch(e) {}
    const similar = db.prepare(`
      SELECT i.id, i.uuid, i.title, i.category, i.status, i.created_at, t.name as tenant_name
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id
      WHERE i.property_id = ? AND i.id != ? AND i.category = ? AND i.category IS NOT NULL
      ORDER BY i.created_at DESC LIMIT 5
    `).all(issue.property_id, issue.id, issue.category);
    // Include persisted AI report if available
    const savedReport = issue.ai_report ? {
      report: issue.ai_report,
      issue,
      attachments: attachments.map(a => ({ id: a.id, file_path: a.file_path, file_type: a.file_type, ai_analysis: a.ai_analysis })),
      messages_count: messages.length,
      generated_at: issue.ai_report_generated_at
    } : null;
    res.json({ issue, messages, attachments, activity, staff, notes, similar, savedReport });
  } finally { db.close(); }
});

router.put('/:id', authenticate, async (req, res) => {
  const { status, priority, category, title, final_cost, final_notes, attended_by, resolution_notes, resolved_at } = req.body;
  const db = getDb();
  try {
    // Get old status for comparison
    const oldIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id);
    const oldStatus = oldIssue?.status;

    const updates = [], params = [];
    if (status) { updates.push('status = ?'); params.push(status); }
    if (priority) { updates.push('priority = ?'); params.push(priority); }
    if (category) { updates.push('category = ?'); params.push(category); }
    if (title) { updates.push('title = ?'); params.push(title); }
    if (final_cost !== undefined) { updates.push('final_cost = ?'); params.push(final_cost); }
    if (final_notes !== undefined) { updates.push('final_notes = ?'); params.push(final_notes); }
    if (attended_by !== undefined) { updates.push('attended_by = ?'); params.push(attended_by); }
    if (resolution_notes !== undefined) { updates.push('resolution_notes = ?'); params.push(resolution_notes); }
    if (resolved_at !== undefined) { updates.push('resolved_at = ?'); params.push(resolved_at); }
    if (status === 'resolved' && !resolved_at) updates.push("resolved_at = CURRENT_TIMESTAMP");
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    db.prepare(`UPDATE issues SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const newIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(req.params.id);
    db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)').run(req.params.id, 'updated', JSON.stringify(req.body), req.user.name);
    recordEntityChange(db, {
      eventType: 'issue_updated',
      domain: 'maintenance',
      importance: status && status !== oldStatus ? 'high' : 'normal',
      entityType: 'issues',
      sourceTable: 'issues',
      entityId: req.params.id,
      issue_id: req.params.id,
      property_id: newIssue?.property_id || oldIssue?.property_id || null,
      tenant_id: newIssue?.tenant_id || oldIssue?.tenant_id || null,
      actor: actorFromUser(req.user),
      before: oldIssue,
      after: newIssue,
      keys: ['status', 'priority', 'category', 'title', 'final_cost', 'final_notes', 'attended_by', 'resolution_notes', 'resolved_at'],
      summary: `Issue updated: ${newIssue?.uuid || req.params.id} ${newIssue?.title || ''}`.trim()
    });
    res.json({ success: true });

    // Auto WhatsApp status update (async, non-blocking)
    if (status && status !== oldStatus) {
      sendStatusUpdate(parseInt(req.params.id), status).catch(err => console.error('[Status Update] Error:', err.message));
    }
  } finally { db.close(); }
});

// Delete an issue and all related data
router.delete('/:id', authenticate, (req, res) => {
  const db = getDb();
  try {
    const issue = db.prepare('SELECT id, uuid FROM issues WHERE id = ?').get(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    // Delete related records first (foreign key dependencies)
    db.prepare('DELETE FROM internal_notes WHERE issue_id = ?').run(req.params.id);
    db.prepare('DELETE FROM attachments WHERE issue_id = ?').run(req.params.id);
    db.prepare('DELETE FROM messages WHERE issue_id = ?').run(req.params.id);
    db.prepare('DELETE FROM activity_log WHERE issue_id = ?').run(req.params.id);
    try { db.prepare('DELETE FROM quotes WHERE issue_id = ?').run(req.params.id); } catch(e) {}
    try { db.prepare('DELETE FROM email_sync_log WHERE issue_id = ?').run(req.params.id); } catch(e) {}

    // Delete the issue itself
    db.prepare('DELETE FROM issues WHERE id = ?').run(req.params.id);
    recordBusinessEvent(db, {
      event_type: 'issue_deleted',
      domain: 'maintenance',
      importance: 'high',
      source_table: 'issues',
      source_id: issue.id,
      issue_id: null,
      actor: actorFromUser(req.user),
      summary: `Issue deleted: ${issue.uuid}`,
      payload: { deleted_issue: issue }
    });
    console.log(`[Issues] Deleted issue ${issue.uuid} (id:${issue.id}) by ${req.user.name}`);
    res.json({ success: true, uuid: issue.uuid });
  } finally { db.close(); }
});

router.post('/:id/respond', authenticate, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  try { res.json(await sendStaffResponse(parseInt(req.params.id), req.user.name, message)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
