const express = require('express');
const { getDb } = require('../database');
const jwt = require('jsonwebtoken');
const { authenticate, requireAdmin, JWT_SECRET } = require('../middleware/auth');
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
    res.json({ url: calendar.getGoogleCalendarAuthUrl(req.user, { calendar_id: req.body?.calendar_id }) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('No authorization code provided');
  if (!state) return res.status(400).send('No calendar owner state provided. Start the calendar connection again from FFR Property OS.');

  try {
    const owner = jwt.verify(state, JWT_SECRET);
    if (owner.purpose !== 'google_calendar_oauth') throw new Error('Invalid Google Calendar OAuth state');
    const account = await calendar.handleGoogleCalendarCallback(code, owner);
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
    res.json(await calendar.syncGoogleCalendarAccount(account, { days: req.body?.days }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sync', authenticate, async (req, res) => {
  try {
    res.json(await calendar.syncAllCalendars({ days: req.body?.days }));
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
