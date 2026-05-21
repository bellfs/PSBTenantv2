const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  DEFAULT_WEBHOOK_EVENTS,
  getPerformanceSummary,
  handleWebhook,
  listAccounts,
  publicWebhookUrl,
  registerWebhook,
  syncAccount,
  syncAllAccounts
} = require('../services/guesty');
const { actorFromUser, recordBusinessEvent, recordEntityChange } = require('../services/business-ledger');

const router = express.Router();

router.post('/webhook', async (req, res) => {
  try {
    const result = await handleWebhook(req);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.use(authenticate);

router.get('/summary', (req, res) => {
  res.json(getPerformanceSummary());
});

router.get('/accounts', (req, res) => {
  const db = getDb();
  try {
    res.json(listAccounts(db));
  } finally {
    db.close();
  }
});

router.post('/accounts', requireAdmin, (req, res) => {
  const { account_name, client_id, client_secret, webhook_secret } = req.body || {};
  if (!client_id || !client_secret) return res.status(400).json({ error: 'Guesty Client ID and Client Secret are required' });
  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM guesty_accounts WHERE client_id = ? ORDER BY id LIMIT 1').get(client_id);
    let id;
    if (existing) {
      const before = existing;
      db.prepare(`
        UPDATE guesty_accounts
        SET account_name = COALESCE(?, account_name),
            client_secret = ?,
            webhook_secret = COALESCE(?, webhook_secret),
            sync_enabled = 1,
            connected_by_staff_id = ?,
            connected_by_email = ?,
            connected_by_name = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        account_name || null,
        client_secret,
        webhook_secret || null,
        req.user?.id || null,
        req.user?.email || null,
        req.user?.name || null,
        existing.id
      );
      id = existing.id;
      const after = db.prepare('SELECT * FROM guesty_accounts WHERE id = ?').get(id);
      recordEntityChange(db, {
        eventType: 'guesty_account_updated',
        domain: 'short_lets',
        importance: 'high',
        entityType: 'guesty_accounts',
        sourceSystem: 'guesty',
        sourceTable: 'guesty_accounts',
        entityId: id,
        actor: actorFromUser(req.user),
        before,
        after,
        keys: ['account_name', 'client_secret', 'webhook_secret', 'sync_enabled'],
        summary: `Guesty account updated: ${after.account_name}`
      });
    } else {
      id = db.prepare(`
        INSERT INTO guesty_accounts (
          account_name, client_id, client_secret, webhook_secret, sync_enabled,
          connected_by_staff_id, connected_by_email, connected_by_name
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        account_name || 'Guesty',
        client_id,
        client_secret,
        webhook_secret || null,
        req.user?.id || null,
        req.user?.email || null,
        req.user?.name || null
      ).lastInsertRowid;
      recordBusinessEvent(db, {
        event_type: 'guesty_account_connected',
        domain: 'short_lets',
        importance: 'high',
        source_system: 'guesty',
        source_table: 'guesty_accounts',
        source_id: id,
        actor: actorFromUser(req.user),
        summary: `Guesty account connected: ${account_name || 'Guesty'}`,
        payload: { account_name: account_name || 'Guesty', client_id: '[configured]' }
      });
    }
    const account = listAccounts(db).find(row => row.id === id);
    res.json({ id, account });
  } finally {
    db.close();
  }
});

router.put('/accounts/:id', requireAdmin, (req, res) => {
  const { account_name, client_id, client_secret, webhook_secret, sync_enabled } = req.body || {};
  const db = getDb();
  try {
    const before = db.prepare('SELECT * FROM guesty_accounts WHERE id = ?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Guesty account not found' });
    db.prepare(`
      UPDATE guesty_accounts
      SET account_name = COALESCE(?, account_name),
          client_id = COALESCE(?, client_id),
          client_secret = COALESCE(?, client_secret),
          webhook_secret = COALESCE(?, webhook_secret),
          sync_enabled = COALESCE(?, sync_enabled),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      account_name || null,
      client_id || null,
      client_secret || null,
      webhook_secret || null,
      sync_enabled == null ? null : (sync_enabled ? 1 : 0),
      req.params.id
    );
    const after = db.prepare('SELECT * FROM guesty_accounts WHERE id = ?').get(req.params.id);
    recordEntityChange(db, {
      eventType: 'guesty_account_updated',
      domain: 'short_lets',
      importance: 'high',
      entityType: 'guesty_accounts',
      sourceSystem: 'guesty',
      sourceTable: 'guesty_accounts',
      entityId: req.params.id,
      actor: actorFromUser(req.user),
      before,
      after,
      keys: ['account_name', 'client_id', 'client_secret', 'webhook_secret', 'sync_enabled'],
      summary: `Guesty account updated: ${after.account_name}`
    });
    res.json({ account: listAccounts(db).find(row => row.id === Number(req.params.id)) });
  } finally {
    db.close();
  }
});

router.post('/accounts/:id/sync', requireAdmin, async (req, res) => {
  try {
    res.json(await syncAccount(Number(req.params.id), { user: req.user, ...req.body }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sync', requireAdmin, async (req, res) => {
  try {
    res.json(await syncAllAccounts({ user: req.user, ...req.body }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/webhooks/register', requireAdmin, async (req, res) => {
  try {
    const baseUrl = req.body?.base_url || `${req.protocol}://${req.get('host')}`;
    res.json(await registerWebhook(req.body?.account_id || null, {
      user: req.user,
      base_url: baseUrl,
      events: req.body?.events
    }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/webhooks/config', (req, res) => {
  res.json({
    url: publicWebhookUrl(`${req.protocol}://${req.get('host')}`),
    events: DEFAULT_WEBHOOK_EVENTS
  });
});

router.get('/listings', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT gl.*, p.name as property_name
      FROM guesty_listings gl
      LEFT JOIN properties p ON p.id = gl.property_id
      ORDER BY gl.active DESC, COALESCE(p.name, gl.title, gl.nickname) COLLATE NOCASE
      LIMIT 500
    `).all();
    res.json(rows);
  } finally {
    db.close();
  }
});

router.get('/reservations', (req, res) => {
  const db = getDb();
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const rows = db.prepare(`
      SELECT gr.*, p.name as property_name, gl.title as listing_title, gl.nickname as listing_nickname
      FROM guesty_reservations gr
      LEFT JOIN properties p ON p.id = gr.property_id
      LEFT JOIN guesty_listings gl ON gl.guesty_account_id = gr.guesty_account_id AND gl.guesty_listing_id = gr.guesty_listing_id
      ORDER BY COALESCE(gr.check_in, gr.last_updated_at, gr.updated_at) DESC
      LIMIT ?
    `).all(limit);
    res.json(rows);
  } finally {
    db.close();
  }
});

router.get('/webhook-events', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT *
      FROM guesty_webhook_events
      ORDER BY received_at DESC
      LIMIT 200
    `).all();
    res.json(rows);
  } finally {
    db.close();
  }
});

module.exports = router;
