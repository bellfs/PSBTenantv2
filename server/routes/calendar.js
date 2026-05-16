const express = require('express');
const { getDb } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const calendar = require('../services/google-calendar');

const router = express.Router();

router.get('/accounts', authenticate, (req, res) => {
  try {
    res.json(calendar.listCalendarAccounts());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/google/auth-url', authenticate, requireAdmin, (req, res) => {
  try {
    res.json({ url: calendar.getGoogleCalendarAuthUrl() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No authorization code provided');

  try {
    const account = await calendar.handleGoogleCalendarCallback(code);
    const db = getDb();
    try {
      const fullAccount = db.prepare('SELECT * FROM calendar_accounts WHERE id = ?').get(account.id);
      if (fullAccount) await calendar.syncGoogleCalendarAccount(fullAccount);
    } finally {
      db.close();
    }
    res.redirect('/?calendar=connected');
  } catch (error) {
    console.error('[Calendar] OAuth callback error:', error.message);
    res.redirect('/?calendar=error&msg=' + encodeURIComponent(error.message));
  }
});

router.post('/accounts/:id/sync', authenticate, async (req, res) => {
  const db = getDb();
  let account;
  try {
    account = db.prepare('SELECT * FROM calendar_accounts WHERE id = ?').get(req.params.id);
  } finally {
    db.close();
  }
  if (!account) return res.status(404).json({ error: 'Calendar account not found' });

  try {
    res.json(await calendar.syncGoogleCalendarAccount(account, { days: req.body?.days || 14 }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sync', authenticate, async (req, res) => {
  try {
    res.json(await calendar.syncAllCalendars({ days: req.body?.days || 14 }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/events', authenticate, (req, res) => {
  try {
    res.json(calendar.listUpcomingEvents(req.query.limit || 25));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
