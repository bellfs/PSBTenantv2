const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { listAgents, getAgent } = require('../agents/registry');
const { runCodexAgent, getCodexVersion } = require('../agents/core/codex-runner');

const router = express.Router();
router.use(authenticate);

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function enrichAgents(db) {
  const runs = db.prepare(`
    SELECT agent_key, status, COUNT(*) as count, MAX(created_at) as last_run_at
    FROM agent_runs
    GROUP BY agent_key, status
  `).all();

  const runMap = {};
  for (const run of runs) {
    if (!runMap[run.agent_key]) runMap[run.agent_key] = { total_runs: 0, statuses: {}, last_run_at: null };
    runMap[run.agent_key].total_runs += run.count;
    runMap[run.agent_key].statuses[run.status] = run.count;
    if (!runMap[run.agent_key].last_run_at || run.last_run_at > runMap[run.agent_key].last_run_at) {
      runMap[run.agent_key].last_run_at = run.last_run_at;
    }
  }

  return listAgents().map(agent => ({ ...agent, metrics: runMap[agent.key] || { total_runs: 0, statuses: {}, last_run_at: null } }));
}

router.get('/', (req, res) => {
  const db = getDb();
  try {
    res.json({
      agents: enrichAgents(db),
      codex: {
        mode: process.env.CODEX_AGENT_MODE === 'execute' ? 'execute' : 'dry_run',
        sandbox: process.env.CODEX_AGENT_SANDBOX || 'read-only'
      }
    });
  } finally { db.close(); }
});

router.get('/health', async (req, res) => {
  const version = await getCodexVersion();
  res.json({
    codex_available: !!version,
    codex_version: version,
    mode: process.env.CODEX_AGENT_MODE === 'execute' ? 'execute' : 'dry_run',
    sandbox: process.env.CODEX_AGENT_SANDBOX || 'read-only'
  });
});

router.get('/runs', (req, res) => {
  const db = getDb();
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = db.prepare(`
      SELECT * FROM agent_runs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    res.json(rows.map(row => ({
      ...row,
      input: parseJson(row.input_json, {}),
      context: parseJson(row.context_json, {})
    })));
  } finally { db.close(); }
});

router.post('/:key/run', async (req, res) => {
  const agent = getAgent(req.params.key);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const { input = {}, context = {}, trigger_type = 'manual', mode = 'dry_run' } = req.body || {};
  const db = getDb();
  let runId;

  try {
    runId = db.prepare(`
      INSERT INTO agent_runs (agent_key, agent_name, trigger_type, status, mode, input_json, context_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.key,
      agent.name,
      trigger_type,
      'running',
      mode,
      JSON.stringify(input),
      JSON.stringify(context),
      req.user?.email || req.user?.name || 'unknown'
    ).lastInsertRowid;

    db.prepare(`
      INSERT INTO agent_events (event_type, domain, source, source_ref, actor, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('agent_run_started', agent.domain, 'ffr_os', String(runId), req.user?.email || req.user?.name || 'unknown', JSON.stringify({ agent_key: agent.key, trigger_type, mode }));
  } finally { db.close(); }

  try {
    const result = await runCodexAgent({ agentKey: agent.key, input, context, mode });
    const db2 = getDb();
    try {
      db2.prepare(`
        UPDATE agent_runs
        SET status = ?, prompt = ?, output_text = ?, codex_command = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(result.status, result.prompt_preview || null, result.output || null, result.codex_command || null, runId);

      db2.prepare(`
        INSERT INTO agent_events (event_type, domain, source, source_ref, actor, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('agent_run_completed', agent.domain, 'ffr_os', String(runId), req.user?.email || req.user?.name || 'unknown', JSON.stringify({ status: result.status, mode: result.mode }));
    } finally { db2.close(); }
    res.json({ id: runId, agent, result });
  } catch (error) {
    const db3 = getDb();
    try {
      db3.prepare('UPDATE agent_runs SET status = ?, error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?').run('failed', error.message, runId);
    } finally { db3.close(); }
    res.status(500).json({ error: error.message, id: runId });
  }
});

router.get('/tasks', (req, res) => {
  const db = getDb();
  try {
    const { status, domain } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (domain) { where.push('t.domain = ?'); params.push(domain); }

    const rows = db.prepare(`
      SELECT t.*, p.name as property_name, tenant.name as tenant_name, i.uuid as issue_ref
      FROM agent_tasks t
      LEFT JOIN properties p ON t.property_id = p.id
      LEFT JOIN tenants tenant ON t.tenant_id = tenant.id
      LEFT JOIN issues i ON t.issue_id = i.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        COALESCE(t.due_date, '9999-12-31') ASC,
        t.created_at DESC
    `).all(...params);
    res.json(rows);
  } finally { db.close(); }
});

router.post('/tasks', (req, res) => {
  const { title, description, domain, property_id, tenant_id, issue_id, priority, status, source, source_ref, assigned_to, due_date } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });

  const db = getDb();
  try {
    const id = db.prepare(`
      INSERT INTO agent_tasks (title, description, domain, property_id, tenant_id, issue_id, priority, status, source, source_ref, assigned_to, due_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title,
      description || null,
      domain || 'operations',
      property_id || null,
      tenant_id || null,
      issue_id || null,
      priority || 'medium',
      status || 'open',
      source || 'manual',
      source_ref || null,
      assigned_to || null,
      due_date || null,
      req.user?.email || req.user?.name || 'unknown'
    ).lastInsertRowid;

    db.prepare(`
      INSERT INTO agent_events (event_type, domain, source, source_ref, actor, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('task_created', domain || 'operations', source || 'manual', source_ref || String(id), req.user?.email || req.user?.name || 'unknown', JSON.stringify({ task_id: id, title, priority: priority || 'medium' }));

    res.json({ id });
  } finally { db.close(); }
});

router.put('/tasks/:id', (req, res) => {
  const { title, description, domain, priority, status, assigned_to, due_date } = req.body || {};
  const db = getDb();
  try {
    db.prepare(`
      UPDATE agent_tasks
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          domain = COALESCE(?, domain),
          priority = COALESCE(?, priority),
          status = COALESCE(?, status),
          assigned_to = COALESCE(?, assigned_to),
          due_date = COALESCE(?, due_date),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title || null, description || null, domain || null, priority || null, status || null, assigned_to || null, due_date || null, req.params.id);
    res.json({ success: true });
  } finally { db.close(); }
});

router.get('/approvals', (req, res) => {
  const db = getDb();
  try {
    const status = req.query.status || 'pending';
    const rows = db.prepare(`
      SELECT a.*, r.agent_key, r.agent_name, t.title as task_title
      FROM agent_approvals a
      LEFT JOIN agent_runs r ON a.agent_run_id = r.id
      LEFT JOIN agent_tasks t ON a.task_id = t.id
      WHERE a.status = ?
      ORDER BY
        CASE a.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        a.created_at DESC
    `).all(status);
    res.json(rows.map(row => ({ ...row, payload: parseJson(row.payload_json, {}) })));
  } finally { db.close(); }
});

router.post('/approvals', requireAdmin, (req, res) => {
  const { agent_run_id, task_id, action_type, title, summary, payload, risk_level } = req.body || {};
  if (!action_type || !title) return res.status(400).json({ error: 'action_type and title required' });
  const db = getDb();
  try {
    const id = db.prepare(`
      INSERT INTO agent_approvals (agent_run_id, task_id, action_type, title, summary, payload_json, risk_level, requested_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(agent_run_id || null, task_id || null, action_type, title, summary || null, JSON.stringify(payload || {}), risk_level || 'medium', req.user?.email || req.user?.name || 'unknown').lastInsertRowid;
    res.json({ id });
  } finally { db.close(); }
});

router.put('/approvals/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected', 'cancelled', 'pending'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  const db = getDb();
  try {
    db.prepare(`
      UPDATE agent_approvals
      SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, req.user?.email || req.user?.name || 'unknown', req.params.id);
    res.json({ success: true });
  } finally { db.close(); }
});

module.exports = router;
