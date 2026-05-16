const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const businessMemory = require('../services/business-memory');

const router = express.Router();
router.use(authenticate);

router.get('/summary', (req, res) => {
  try {
    res.json(businessMemory.getMemorySummary());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/snapshot', requireAdmin, (req, res) => {
  try {
    const result = businessMemory.snapshotBusinessMemory({
      createdBy: req.user?.email || req.user?.name || 'user'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/files', (req, res) => {
  try {
    res.json(businessMemory.listMemoryFiles());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/file', (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: 'path required' });
    res.json(businessMemory.readMemoryFile(req.query.path));
  } catch (error) {
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;
