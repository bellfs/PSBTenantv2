const express = require('express');
const { getDb } = require('../database');
const jwt = require('jsonwebtoken');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const emailSync = require('../services/email-sync');
const { actorFromUser, recordBusinessEvent, recordEntityChange } = require('../services/business-ledger');

const router = express.Router();

function canManageAccount(user, account) {
  if (!user || !account) return false;
  if (user.role === 'admin') return true;
  if (account.connected_by_staff_id && Number(account.connected_by_staff_id) === Number(user.id)) return true;
  if (account.connected_by_email && user.email && account.connected_by_email.toLowerCase() === user.email.toLowerCase()) return true;
  return false;
}

function accountOwner(user) {
  return {
    id: user?.id || null,
    email: user?.email || null,
    name: user?.name || user?.email || null,
    role: user?.role || null
  };
}

// List connected email accounts
router.get('/accounts', authenticate, (req, res) => {
  const db = getDb();
  try {
    const accounts = db.prepare(`
      SELECT id, provider, email_address, last_sync_at, last_context_at, sync_enabled, created_at,
        connected_by_staff_id, connected_by_email, connected_by_name, connection_scope, sync_window_days
      FROM email_accounts
      ORDER BY created_at DESC
    `).all();
    res.json(accounts.map(account => ({
      ...account,
      can_manage: canManageAccount(req.user, account),
      owner_label: account.connected_by_name || account.connected_by_email || 'Team account'
    })));
  } finally { db.close(); }
});

// Generate Gmail OAuth URL
router.post('/accounts/gmail/auth-url', authenticate, (req, res) => {
  try {
    const url = emailSync.getGmailAuthUrl(accountOwner(req.user));
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Gmail OAuth callback
router.get('/accounts/gmail/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('No authorization code provided');
  if (!state) return res.status(400).send('No account owner state provided. Start the Gmail connection again from Settings.');

  try {
    const owner = jwt.verify(state, JWT_SECRET);
    if (owner.purpose !== 'gmail_oauth') throw new Error('Invalid Gmail OAuth state');
    await emailSync.handleGmailCallback(code, owner);
    // Redirect back to settings page
    res.redirect('/settings?tab=email&gmail=connected');
  } catch (e) {
    console.error('[Gmail] OAuth callback error:', e.message);
    res.redirect('/settings?tab=email&gmail=error&msg=' + encodeURIComponent(e.message));
  }
});

// Add IMAP account (Zoho, etc.)
router.post('/accounts/imap', authenticate, async (req, res) => {
  const { email_address, host, port, username, password } = req.body;
  if (!email_address || !host || !username || !password) {
    return res.status(400).json({ error: 'email_address, host, username, and password are required' });
  }

  try {
    // Test connection first
    await emailSync.testImapConnection({ host, port: port || 993, username, password });

    const db = getDb();
    try {
      const credentials = JSON.stringify({ host, port: port || 993, username, password });
      const existing = db.prepare('SELECT * FROM email_accounts WHERE provider = ? AND LOWER(email_address) = LOWER(?)').get('imap', email_address);
      const owner = accountOwner(req.user);
      let id;
      if (existing) {
        if (!canManageAccount(req.user, existing) && (existing.connected_by_staff_id || existing.connected_by_email)) {
          return res.status(403).json({ error: 'Only the person who connected this inbox, or an admin, can replace its credentials.' });
        }
        db.prepare(`
          UPDATE email_accounts
          SET credentials = ?,
              sync_enabled = 1,
              connected_by_staff_id = COALESCE(connected_by_staff_id, ?),
              connected_by_email = COALESCE(connected_by_email, ?),
              connected_by_name = COALESCE(connected_by_name, ?),
              connection_scope = 'team_context',
              sync_window_days = COALESCE(sync_window_days, 30)
          WHERE id = ?
        `).run(credentials, owner.id, owner.email, owner.name, existing.id);
        id = existing.id;
      } else {
        id = db.prepare(`
          INSERT INTO email_accounts (
            provider, email_address, credentials, sync_enabled,
            connected_by_staff_id, connected_by_email, connected_by_name, connection_scope, sync_window_days
          ) VALUES (?, ?, ?, 1, ?, ?, ?, 'team_context', 30)
        `).run('imap', email_address, credentials, owner.id, owner.email, owner.name).lastInsertRowid;
      }
      console.log(`[IMAP] Connected: ${email_address} via ${host}`);
      recordBusinessEvent(db, {
        event_type: existing ? 'email_account_reconnected' : 'email_account_connected',
        domain: 'communications',
        importance: 'high',
        source_table: 'email_accounts',
        source_id: id,
        external_id: email_address,
        actor: actorFromUser(req.user),
        summary: `${email_address} connected via IMAP`,
        payload: { provider: 'imap', email_address, host, port: port || 993, username, connected_by_email: owner.email, connected_by_name: owner.name }
      });
      res.json({ id, email_address, provider: 'imap' });
    } finally { db.close(); }
  } catch (e) {
    res.status(400).json({ error: `Connection test failed: ${e.message}` });
  }
});

// Toggle email account sync
router.put('/accounts/:id', authenticate, (req, res) => {
  const { sync_enabled } = req.body;
  const db = getDb();
  try {
    const account = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!canManageAccount(req.user, account)) return res.status(403).json({ error: 'You can only manage email accounts you connected.' });
    db.prepare('UPDATE email_accounts SET sync_enabled = ? WHERE id = ?').run(sync_enabled ? 1 : 0, req.params.id);
    const after = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(req.params.id);
    recordEntityChange(db, {
      eventType: 'email_account_updated',
      domain: 'communications',
      importance: 'high',
      entityType: 'email_accounts',
      sourceTable: 'email_accounts',
      entityId: req.params.id,
      actor: actorFromUser(req.user),
      before: account,
      after,
      keys: ['sync_enabled'],
      summary: `Email account ${sync_enabled ? 'enabled' : 'paused'}: ${account.email_address}`
    });
    res.json({ success: true });
  } finally { db.close(); }
});

// Delete email account
router.delete('/accounts/:id', authenticate, (req, res) => {
  const db = getDb();
  try {
    const account = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!canManageAccount(req.user, account)) return res.status(403).json({ error: 'You can only remove email accounts you connected.' });
    db.prepare('UPDATE email_agent_drafts SET email_account_id = NULL WHERE email_account_id = ?').run(req.params.id);
    db.prepare(`
      UPDATE email_agent_items
      SET email_account_id = NULL,
          email_sync_log_id = NULL
      WHERE email_account_id = ?
         OR email_sync_log_id IN (SELECT id FROM email_sync_log WHERE email_account_id = ?)
    `).run(req.params.id, req.params.id);
    db.prepare('DELETE FROM email_sync_log WHERE email_account_id = ?').run(req.params.id);
    db.prepare('DELETE FROM email_accounts WHERE id = ?').run(req.params.id);
    recordBusinessEvent(db, {
      event_type: 'email_account_deleted',
      domain: 'communications',
      importance: 'high',
      source_table: 'email_accounts',
      source_id: req.params.id,
      external_id: account.email_address,
      actor: actorFromUser(req.user),
      summary: `Email account removed: ${account.email_address}`,
      payload: { account }
    });
    res.json({ success: true });
  } finally { db.close(); }
});

// Trigger manual sync for a specific account
router.post('/accounts/:id/sync', authenticate, async (req, res) => {
  const db = getDb();
  let account;
  try {
    account = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(req.params.id);
  } finally { db.close(); }

  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (!canManageAccount(req.user, account)) return res.status(403).json({ error: 'You can only sync email accounts you connected.' });

  try {
    let result;
    if (account.provider === 'gmail') {
      result = await emailSync.syncGmailAccount(account);
    } else if (account.provider === 'imap') {
      result = await emailSync.syncImapAccount(account);
    }
    res.json(result || { error: 'Unknown provider' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan all connected inboxes for tenant complaints (triggered from Issues page)
router.post('/scan-inbox', authenticate, async (req, res) => {
  try {
    const result = await emailSync.syncAllAccounts();
    res.json(result);
  } catch (e) {
    console.error('[EmailScan] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get sync log
router.get('/sync-log', authenticate, (req, res) => {
  const db = getDb();
  try {
    const logs = db.prepare(`
      SELECT l.*, ea.email_address as account_email, ea.provider,
        t.name as tenant_name
      FROM email_sync_log l
      LEFT JOIN email_accounts ea ON l.email_account_id = ea.id
      LEFT JOIN tenants t ON l.matched_tenant_id = t.id
      ORDER BY l.processed_at DESC LIMIT 100
    `).all();
    res.json(logs);
  } finally { db.close(); }
});

module.exports = router;
