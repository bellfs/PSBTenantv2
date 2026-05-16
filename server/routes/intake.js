const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const { parseWhatsAppExport, classifyMessage, buildExternalId } = require('../services/intake');

const router = express.Router();
router.use(authenticate);

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function insertEvent(db, event) {
  db.prepare(`
    INSERT INTO agent_events (event_type, domain, source, source_ref, actor, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.event_type,
    event.domain || 'operations',
    event.source || 'intake',
    event.source_ref || null,
    event.actor || null,
    JSON.stringify(event.payload || {})
  );
}

function processMessage(db, message, options, user) {
  const sourceName = options.source_name || 'whatsapp_export';
  const externalId = buildExternalId(sourceName, message);
  const actor = user?.email || user?.name || 'unknown';

  let itemId;
  const existing = db.prepare('SELECT id FROM intake_items WHERE source_type = ? AND external_id = ?').get('whatsapp_export', externalId);
  if (existing) {
    itemId = existing.id;
  } else {
    itemId = db.prepare(`
      INSERT INTO intake_items (source_type, source_name, external_id, sender, occurred_at, content, raw_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'whatsapp_export',
      sourceName,
      externalId,
      message.sender || null,
      message.occurred_at || null,
      message.content,
      JSON.stringify(message),
      actor
    ).lastInsertRowid;
  }

  const classification = classifyMessage(message);
  insertEvent(db, {
    event_type: 'intake_message_processed',
    domain: classification.domain,
    source: 'whatsapp_export',
    source_ref: String(itemId),
    actor,
    payload: { source_name: sourceName, sender: message.sender, occurred_at: message.occurred_at, agent_key: classification.agent_key }
  });

  let taskId = null;
  let approvalId = null;
  let extractionId = null;

  if (classification.should_create_task && !existing) {
    taskId = db.prepare(`
      INSERT INTO agent_tasks (title, description, domain, priority, status, source, source_ref, due_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      classification.title,
      classification.summary,
      classification.domain,
      classification.priority,
      'open',
      'whatsapp_export',
      String(itemId),
      null,
      actor
    ).lastInsertRowid;

    insertEvent(db, {
      event_type: 'task_created_from_intake',
      domain: classification.domain,
      source: 'whatsapp_export',
      source_ref: String(itemId),
      actor,
      payload: { task_id: taskId, agent_key: classification.agent_key, priority: classification.priority }
    });

    if (classification.should_request_approval) {
      approvalId = db.prepare(`
        INSERT INTO agent_approvals (task_id, action_type, title, summary, payload_json, risk_level, requested_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        'run_agent_or_external_action',
        `Review before action: ${classification.title}`,
        classification.summary,
        JSON.stringify({
          agent_key: classification.agent_key,
          intake_item_id: itemId,
          suggested_action: 'Run the suggested agent, then approve any external action separately.'
        }),
        classification.risk_level,
        actor
      ).lastInsertRowid;
    }

    extractionId = db.prepare(`
      INSERT INTO intake_extractions (intake_item_id, extraction_type, title, summary, domain, priority, confidence, status, agent_key, risk_level, payload_json, task_id, approval_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      classification.should_request_approval ? 'task_with_approval' : 'task',
      classification.title,
      classification.summary,
      classification.domain,
      classification.priority,
      classification.confidence,
      'created',
      classification.agent_key,
      classification.risk_level,
      JSON.stringify(classification),
      taskId,
      approvalId
    ).lastInsertRowid;
  } else if (!existing && classification.agent_key) {
    extractionId = db.prepare(`
      INSERT INTO intake_extractions (intake_item_id, extraction_type, title, summary, domain, priority, confidence, status, agent_key, risk_level, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId,
      'context',
      classification.title,
      classification.summary,
      classification.domain,
      classification.priority,
      classification.confidence,
      'logged',
      classification.agent_key,
      classification.risk_level,
      JSON.stringify(classification)
    ).lastInsertRowid;
  }

  return { item_id: itemId, extraction_id: extractionId, task_id: taskId, approval_id: approvalId, classification, duplicate: !!existing };
}

router.post('/whatsapp-export', (req, res) => {
  const { text, source_name } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });

  const messages = parseWhatsAppExport(text);
  const db = getDb();
  const results = [];

  try {
    for (const message of messages) {
      results.push(processMessage(db, message, { source_name }, req.user));
    }

    const createdTasks = results.filter(r => r.task_id).length;
    const createdApprovals = results.filter(r => r.approval_id).length;
    const duplicates = results.filter(r => r.duplicate).length;

    res.json({
      imported_messages: messages.length,
      created_tasks: createdTasks,
      created_approvals: createdApprovals,
      duplicate_messages: duplicates,
      suggested_agents: [...new Set(results.map(r => r.classification.agent_key).filter(Boolean))],
      sample: results.filter(r => r.task_id || r.approval_id).slice(0, 10)
    });
  } finally { db.close(); }
});

router.get('/summary', (req, res) => {
  const db = getDb();
  try {
    const totalItems = db.prepare('SELECT COUNT(*) as c FROM intake_items').get().c;
    const totalTasks = db.prepare("SELECT COUNT(*) as c FROM intake_extractions WHERE extraction_type IN ('task','task_with_approval')").get().c;
    const pendingApprovals = db.prepare("SELECT COUNT(*) as c FROM agent_approvals WHERE status = 'pending'").get().c;
    const byDomain = db.prepare(`
      SELECT domain, COUNT(*) as count
      FROM intake_extractions
      GROUP BY domain
      ORDER BY count DESC
    `).all();
    const byAgent = db.prepare(`
      SELECT agent_key, COUNT(*) as count
      FROM intake_extractions
      WHERE agent_key IS NOT NULL
      GROUP BY agent_key
      ORDER BY count DESC
    `).all();
    res.json({ total_items: totalItems, extracted_tasks: totalTasks, pending_approvals: pendingApprovals, by_domain: byDomain, by_agent: byAgent });
  } finally { db.close(); }
});

router.get('/items', (req, res) => {
  const db = getDb();
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const rows = db.prepare(`
      SELECT i.*,
        (SELECT COUNT(*) FROM intake_extractions WHERE intake_item_id = i.id) as extraction_count
      FROM intake_items i
      ORDER BY COALESCE(i.occurred_at, i.created_at) DESC
      LIMIT ?
    `).all(limit);
    res.json(rows.map(row => ({ ...row, raw: parseJson(row.raw_json, {}) })));
  } finally { db.close(); }
});

router.get('/extractions', (req, res) => {
  const db = getDb();
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const rows = db.prepare(`
      SELECT e.*, i.sender, i.occurred_at, i.source_name
      FROM intake_extractions e
      JOIN intake_items i ON i.id = e.intake_item_id
      ORDER BY e.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json(rows.map(row => ({ ...row, payload: parseJson(row.payload_json, {}) })));
  } finally { db.close(); }
});

module.exports = router;
