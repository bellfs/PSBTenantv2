const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { callLLM } = require('../services/llm');
const { actorFromUser, recordBusinessEvent, recordEntityChange } = require('../services/business-ledger');

const router = express.Router();

// List all contractors
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  try {
    const contractors = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM quotes WHERE contractor_id = c.id) as total_quotes,
        (SELECT COUNT(*) FROM quotes WHERE contractor_id = c.id AND status = 'completed') as completed_jobs,
        (SELECT COALESCE(SUM(amount), 0) FROM quotes WHERE contractor_id = c.id AND status = 'completed') as total_spend
      FROM contractors c ORDER BY c.name ASC
    `).all();
    res.json(contractors);
  } finally { db.close(); }
});

// Add contractor
router.post('/', authenticate, requireAdmin, (req, res) => {
  const { name, trade, phone, email, notes } = req.body;
  if (!name || !trade) return res.status(400).json({ error: 'Name and trade required' });
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO contractors (name, trade, phone, email, notes) VALUES (?, ?, ?, ?, ?)').run(name, trade, phone || null, email || null, notes || null);
    recordBusinessEvent(db, {
      event_type: 'contractor_created',
      domain: 'contractors',
      importance: 'high',
      source_table: 'contractors',
      source_id: result.lastInsertRowid,
      actor: actorFromUser(req.user),
      summary: `Contractor created: ${name}`,
      payload: { name, trade, phone, email, notes }
    });
    res.json({ success: true, id: result.lastInsertRowid });
  } finally { db.close(); }
});

// Update contractor
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  const { name, trade, phone, email, notes, active } = req.body;
  const db = getDb();
  try {
    const before = db.prepare('SELECT * FROM contractors WHERE id = ?').get(req.params.id);
    const updates = [], params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (trade !== undefined) { updates.push('trade = ?'); params.push(trade); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
    if (updates.length === 0) return res.json({ success: true });
    params.push(req.params.id);
    db.prepare(`UPDATE contractors SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const after = db.prepare('SELECT * FROM contractors WHERE id = ?').get(req.params.id);
    recordEntityChange(db, {
      eventType: 'contractor_updated',
      domain: 'contractors',
      importance: 'high',
      entityType: 'contractors',
      sourceTable: 'contractors',
      entityId: req.params.id,
      actor: actorFromUser(req.user),
      before,
      after,
      keys: ['name', 'trade', 'phone', 'email', 'notes', 'active'],
      summary: `Contractor updated: ${after?.name || before?.name || req.params.id}`
    });
    res.json({ success: true });
  } finally { db.close(); }
});

// Get contractor quote history
router.get('/:id/quotes', authenticate, (req, res) => {
  const db = getDb();
  try {
    const quotes = db.prepare(`
      SELECT q.*, i.uuid as issue_uuid, i.title as issue_title, i.category as issue_category,
        p.name as property_name
      FROM quotes q
      LEFT JOIN issues i ON q.issue_id = i.id
      LEFT JOIN properties p ON i.property_id = p.id
      WHERE q.contractor_id = ?
      ORDER BY q.created_at DESC
    `).all(req.params.id);
    const contractor = db.prepare('SELECT * FROM contractors WHERE id = ?').get(req.params.id);
    res.json({ contractor, quotes });
  } finally { db.close(); }
});

// Get quotes for an issue
router.get('/issues/:id/quotes', authenticate, (req, res) => {
  const db = getDb();
  try {
    const quotes = db.prepare(`
      SELECT q.*, c.name as contractor_name, c.trade as contractor_trade, c.phone as contractor_phone
      FROM quotes q LEFT JOIN contractors c ON q.contractor_id = c.id
      WHERE q.issue_id = ? ORDER BY q.created_at DESC
    `).all(req.params.id);
    res.json(quotes);
  } finally { db.close(); }
});

// Create quote request for an issue
router.post('/issues/:id/quotes', authenticate, (req, res) => {
  const { contractor_id, description } = req.body;
  if (!contractor_id) return res.status(400).json({ error: 'Contractor required' });
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO quotes (issue_id, contractor_id, description, status) VALUES (?, ?, ?, ?)').run(
      req.params.id, contractor_id, description || null, 'requested'
    );
    const issue = db.prepare('SELECT id, uuid, property_id, tenant_id FROM issues WHERE id = ?').get(req.params.id);
    db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)').run(
      req.params.id, 'quote_requested', `Quote requested from contractor #${contractor_id}`, req.user.name
    );
    recordBusinessEvent(db, {
      event_type: 'quote_requested',
      domain: 'maintenance',
      importance: 'high',
      source_table: 'quotes',
      source_id: result.lastInsertRowid,
      property_id: issue?.property_id || null,
      tenant_id: issue?.tenant_id || null,
      issue_id: req.params.id,
      actor: actorFromUser(req.user),
      summary: `Quote requested for issue ${issue?.uuid || req.params.id}`,
      payload: { issue_id: req.params.id, contractor_id, description }
    });
    res.json({ success: true, id: result.lastInsertRowid });
  } finally { db.close(); }
});

// Update quote (set amount, approve, reject, complete)
router.put('/quotes/:id', authenticate, (req, res) => {
  const { amount, status, notes } = req.body;
  const db = getDb();
  try {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const issue = db.prepare('SELECT id, uuid, property_id, tenant_id FROM issues WHERE id = ?').get(quote.issue_id);

    const updates = [], params = [];
    if (amount !== undefined) { updates.push('amount = ?'); params.push(amount); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (status) {
      updates.push('status = ?'); params.push(status);
      if (status === 'received') updates.push('quoted_at = CURRENT_TIMESTAMP');
      if (status === 'approved') updates.push('approved_at = CURRENT_TIMESTAMP');
      if (status === 'completed') updates.push('completed_at = CURRENT_TIMESTAMP');
    }
    if (updates.length === 0) return res.json({ success: true });
    params.push(req.params.id);
    db.prepare(`UPDATE quotes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updatedQuote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);

    // When completed, update issue final_cost and attended_by
    if (status === 'completed' && (amount || quote.amount)) {
      const contractor = db.prepare('SELECT name FROM contractors WHERE id = ?').get(quote.contractor_id);
      db.prepare('UPDATE issues SET final_cost = ?, attended_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        amount || quote.amount, contractor?.name || 'Contractor', quote.issue_id
      );
    }

    db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)').run(
      quote.issue_id, `quote_${status || 'updated'}`, `Quote #${req.params.id}: ${status || 'updated'}${amount ? ' £' + amount : ''}`, req.user.name
    );
    recordEntityChange(db, {
      eventType: 'quote_updated',
      domain: 'maintenance',
      importance: status ? 'high' : 'normal',
      entityType: 'quotes',
      sourceTable: 'quotes',
      entityId: req.params.id,
      property_id: issue?.property_id || null,
      tenant_id: issue?.tenant_id || null,
      issue_id: quote.issue_id,
      actor: actorFromUser(req.user),
      before: quote,
      after: updatedQuote,
      keys: ['amount', 'status', 'notes', 'quoted_at', 'approved_at', 'completed_at'],
      summary: `Quote updated for issue ${issue?.uuid || quote.issue_id}: ${status || 'updated'}`
    });
    res.json({ success: true });
  } finally { db.close(); }
});

// Generate AI job brief for an issue
router.post('/issues/:id/job-brief', authenticate, async (req, res) => {
  const db = getDb();
  try {
    const issue = db.prepare(`
      SELECT i.*, t.name as tenant_name, t.phone as tenant_phone, t.flat_number as tenant_flat,
        p.name as property_name, p.address as property_address, p.postcode as property_postcode
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN properties p ON i.property_id = p.id
      WHERE i.id = ?
    `).get(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const messages = db.prepare('SELECT sender, content, message_type FROM messages WHERE issue_id = ? ORDER BY created_at ASC').all(req.params.id);
    const attachments = db.prepare('SELECT file_path, ai_analysis FROM attachments WHERE issue_id = ?').all(req.params.id);

    const conversationSummary = messages.map(m => {
      const role = m.sender === 'tenant' ? 'Tenant' : m.sender === 'bot' ? 'AI Bot' : 'Staff';
      return `${role}: ${m.content || '[photo]'}`;
    }).join('\n');

    const photoAnalyses = attachments.filter(a => a.ai_analysis).map(a => {
      try { return JSON.parse(a.ai_analysis.replace(/```json\n?/g, '').replace(/```\n?/g, '')); }
      catch { return null; }
    }).filter(Boolean);

    const prompt = `Generate a professional job brief for a contractor based on this maintenance issue.

Property: ${issue.property_name || 'Unknown'}, ${issue.property_address || ''} ${issue.property_postcode || ''}
Flat/Unit: ${issue.flat_number || issue.tenant_flat || 'Not specified'}
Tenant: ${issue.tenant_name || 'Unknown'}
Issue Ref: ${issue.uuid}
Category: ${issue.category || 'Not categorised'}
AI Diagnosis: ${issue.ai_diagnosis || 'Not yet diagnosed'}
Priority: ${issue.priority || 'medium'}

Conversation:
${conversationSummary}

${photoAnalyses.length > 0 ? 'Photo Analysis:\n' + photoAnalyses.map(p => `- ${p.description || p.likely_issue}`).join('\n') : 'No photos analysed yet.'}

Write a clear, professional job brief that a contractor can use. Include:
1) Location and access details
2) Description of the issue
3) What has been identified so far
4) What needs to be done
5) Any safety considerations
6) Request for a fixed-price quote

Keep it concise and practical. No markdown formatting.`;

    const brief = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 600 });
    res.json({ brief });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally { db.close(); }
});

module.exports = router;
