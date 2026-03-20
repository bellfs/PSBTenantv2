const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const emailSync = require('../services/email-sync');

const router = express.Router();

// List connected email accounts
router.get('/accounts', authenticate, requireAdmin, (req, res) => {
  const db = getDb();
  try {
    const accounts = db.prepare('SELECT id, provider, email_address, last_sync_at, sync_enabled, created_at FROM email_accounts ORDER BY created_at DESC').all();
    res.json(accounts);
  } finally { db.close(); }
});

// Generate Gmail OAuth URL
router.post('/accounts/gmail/auth-url', authenticate, requireAdmin, (req, res) => {
  try {
    const url = emailSync.getGmailAuthUrl();
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Gmail OAuth callback
router.get('/accounts/gmail/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No authorization code provided');

  try {
    const account = await emailSync.handleGmailCallback(code);
    // Redirect back to settings page
    res.redirect('/settings?tab=email&gmail=connected');
  } catch (e) {
    console.error('[Gmail] OAuth callback error:', e.message);
    res.redirect('/settings?tab=email&gmail=error&msg=' + encodeURIComponent(e.message));
  }
});

// Add IMAP account
router.post('/accounts/imap', authenticate, requireAdmin, async (req, res) => {
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
      const result = db.prepare('INSERT INTO email_accounts (provider, email_address, credentials, sync_enabled) VALUES (?, ?, ?, 1)')
        .run('imap', email_address, credentials);
      res.json({ id: result.lastInsertRowid, email_address, provider: 'imap' });
    } finally { db.close(); }
  } catch (e) {
    res.status(400).json({ error: `Connection test failed: ${e.message}` });
  }
});

// Toggle email account sync
router.put('/accounts/:id', authenticate, requireAdmin, (req, res) => {
  const { sync_enabled } = req.body;
  const db = getDb();
  try {
    db.prepare('UPDATE email_accounts SET sync_enabled = ? WHERE id = ?').run(sync_enabled ? 1 : 0, req.params.id);
    res.json({ success: true });
  } finally { db.close(); }
});

// Delete email account
router.delete('/accounts/:id', authenticate, requireAdmin, (req, res) => {
  const db = getDb();
  try {
    db.prepare('DELETE FROM email_sync_log WHERE email_account_id = ?').run(req.params.id);
    db.prepare('DELETE FROM email_accounts WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } finally { db.close(); }
});

// Trigger manual sync
router.post('/accounts/:id/sync', authenticate, requireAdmin, async (req, res) => {
  const db = getDb();
  let account;
  try {
    account = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(req.params.id);
  } finally { db.close(); }

  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    let result;
    const creds = account.credentials ? JSON.parse(account.credentials) : {};
    // Gmail accounts with host field are App Password (IMAP) accounts
    if (account.provider === 'gmail' && creds.host) {
      result = await emailSync.syncImapAccount(account);
    } else if (account.provider === 'gmail') {
      result = await emailSync.syncGmailAccount(account);
    } else if (account.provider === 'imap') {
      result = await emailSync.syncImapAccount(account);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Connect Gmail via App Password (IMAP) - simplified setup for admin@52oldelvet.com
router.post('/accounts/gmail-app', authenticate, requireAdmin, async (req, res) => {
  const { email_address, app_password } = req.body;
  if (!email_address || !app_password) {
    return res.status(400).json({ error: 'Email address and app password are required' });
  }

  const config = { host: 'imap.gmail.com', port: 993, username: email_address, password: app_password };

  try {
    // Test connection first
    await emailSync.testImapConnection(config);

    const db = getDb();
    try {
      // Remove any existing account for this email to avoid duplicates
      db.prepare('DELETE FROM email_accounts WHERE email_address = ?').run(email_address);
      const credentials = JSON.stringify(config);
      const result = db.prepare('INSERT INTO email_accounts (provider, email_address, credentials, sync_enabled) VALUES (?, ?, ?, 1)')
        .run('gmail', email_address, credentials);
      console.log(`[Gmail App] Connected: ${email_address}`);
      res.json({ id: result.lastInsertRowid, email_address, provider: 'gmail' });
    } finally { db.close(); }
  } catch (e) {
    console.error('[Gmail App] Connection test failed:', e.message);
    res.status(400).json({ error: `Connection failed: ${e.message}. Make sure you're using a Google App Password (not your regular password) and IMAP is enabled in Gmail settings.` });
  }
});

// Scan all connected inboxes for tenant complaints (triggered from Issues page)
router.post('/scan-inbox', authenticate, async (req, res) => {
  try {
    const result = await emailSync.scanAllAccounts();
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
