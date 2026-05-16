const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const emailSync = require('../services/email-sync');
const emailAgent = require('../services/email-agent');

const router = express.Router();
router.use(authenticate);

router.get('/summary', (req, res) => {
  try {
    res.json(emailAgent.getSummary());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/items', (req, res) => {
  try {
    res.json(emailAgent.getItems(req.query.limit || 100));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/drafts', (req, res) => {
  try {
    res.json(emailAgent.getDrafts(req.query.status || 'draft', req.query.limit || 100));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    const sync = await emailSync.syncAllAccounts();
    res.json({ sync, summary: emailAgent.getSummary(), items: emailAgent.getItems(25), drafts: emailAgent.getDrafts('draft', 25) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/drafts/:id', (req, res) => {
  try {
    const draft = emailAgent.updateDraft(req.params.id, req.body || {}, req.user?.email || req.user?.name || 'user');
    res.json(draft);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/drafts/:id/approve', (req, res) => {
  try {
    const draft = emailAgent.approveDraft(req.params.id, req.user?.email || req.user?.name || 'user');
    res.json(draft);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/drafts/:id/send', requireAdmin, async (req, res) => {
  try {
    const result = await emailAgent.sendDraft(req.params.id, req.user?.email || req.user?.name || 'user');
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/reports/daily/preview', (req, res) => {
  try {
    const report = emailAgent.buildDailyReport(req.body?.date || emailAgent.todayKey());
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/reports/daily/send', requireAdmin, async (req, res) => {
  try {
    const result = await emailAgent.sendDailyReport(req.body?.date || emailAgent.todayKey(), req.user?.email || req.user?.name || 'user');
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/reports', (req, res) => {
  const { getDb } = require('../database');
  const db = getDb();
  try {
    res.json(db.prepare('SELECT * FROM email_agent_reports ORDER BY report_date DESC LIMIT ?').all(Number(req.query.limit || 30)));
  } finally {
    db.close();
  }
});

module.exports = router;
