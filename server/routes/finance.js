const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { syncAccount, categoriseTransactions } = require('../services/bank-sync');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ===== BANK ACCOUNTS =====

// List all connected bank accounts
router.get('/accounts', (req, res) => {
  const db = getDb();
  const accounts = db.prepare(`
    SELECT id, provider, account_name, account_id, currency, last_sync_at, sync_enabled, balance, created_at,
    (SELECT COUNT(*) FROM bank_transactions WHERE bank_account_id = bank_accounts.id) as txn_count
    FROM bank_accounts ORDER BY created_at DESC
  `).all();
  res.json(accounts);
});

// Add a bank account (API token based — Starling/Wise/Pleo)
router.post('/accounts', (req, res) => {
  const db = getDb();
  const { provider, account_name, access_token } = req.body;
  if (!provider || !account_name || !access_token) {
    return res.status(400).json({ error: 'Provider, account_name, and access_token required' });
  }
  if (!['starling', 'wise', 'pleo'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be starling, wise, or pleo' });
  }

  const result = db.prepare(
    'INSERT INTO bank_accounts (provider, account_name, access_token) VALUES (?, ?, ?)'
  ).run(provider, account_name, access_token);

  res.json({ id: result.lastInsertRowid, message: 'Account connected' });
});

// Update account (toggle sync, update token)
router.put('/accounts/:id', (req, res) => {
  const db = getDb();
  const { sync_enabled, access_token, account_name } = req.body;
  const updates = [];
  const params = [];

  if (sync_enabled !== undefined) { updates.push('sync_enabled = ?'); params.push(sync_enabled ? 1 : 0); }
  if (access_token) { updates.push('access_token = ?'); params.push(access_token); }
  if (account_name) { updates.push('account_name = ?'); params.push(account_name); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE bank_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ message: 'Account updated' });
});

// Delete account + its transactions
router.delete('/accounts/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM bank_transactions WHERE bank_account_id = ?').run(req.params.id);
  db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Account removed' });
});

// Trigger sync for an account
router.post('/accounts/:id/sync', async (req, res) => {
  try {
    const result = await syncAccount(parseInt(req.params.id));
    res.json({ message: 'Sync completed', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== TRANSACTIONS =====

// List transactions with filters
router.get('/transactions', (req, res) => {
  const db = getDb();
  const { direction, category, property_id, account_id, search, from, to, uncategorised, limit, offset } = req.query;
  let where = ['1=1'];
  let params = [];

  if (direction) { where.push('t.direction = ?'); params.push(direction); }
  if (category) { where.push('t.ai_category = ?'); params.push(category); }
  if (property_id) { where.push('t.property_id = ?'); params.push(property_id); }
  if (account_id) { where.push('t.bank_account_id = ?'); params.push(account_id); }
  if (uncategorised === '1') { where.push('t.ai_category IS NULL'); }
  if (from) { where.push('t.date >= ?'); params.push(from); }
  if (to) { where.push('t.date <= ?'); params.push(to); }
  if (search) {
    where.push('(t.counterparty LIKE ? OR t.reference LIKE ? OR t.description LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const lim = Math.min(parseInt(limit) || 100, 500);
  const off = parseInt(offset) || 0;

  const transactions = db.prepare(`
    SELECT t.*, ba.provider, ba.account_name,
      p.name as property_name
    FROM bank_transactions t
    LEFT JOIN bank_accounts ba ON t.bank_account_id = ba.id
    LEFT JOIN properties p ON t.property_id = p.id
    WHERE ${where.join(' AND ')}
    ORDER BY t.date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, lim, off);

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM bank_transactions t WHERE ${where.join(' AND ')}
  `).get(...params);

  res.json({ transactions, total: total.count, limit: lim, offset: off });
});

// Tag/update a transaction
router.put('/transactions/:id', (req, res) => {
  const db = getDb();
  const { property_id, issue_id, ai_category, notes } = req.body;
  const updates = [];
  const params = [];

  if (property_id !== undefined) { updates.push('property_id = ?'); params.push(property_id || null); }
  if (issue_id !== undefined) { updates.push('issue_id = ?'); params.push(issue_id || null); }
  if (ai_category !== undefined) { updates.push('ai_category = ?'); params.push(ai_category); updates.push('tagged_by = ?'); params.push('manual'); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE bank_transactions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ message: 'Transaction updated' });
});

// AI categorise uncategorised transactions
router.post('/categorise', async (req, res) => {
  try {
    const { transaction_ids } = req.body;
    const result = await categoriseTransactions(transaction_ids);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ANALYTICS =====

// Finance summary / dashboard data
router.get('/summary', (req, res) => {
  const db = getDb();
  const { from, to, months } = req.query;

  // Default: last 3 months
  let dateFrom, dateTo;
  if (from && to) {
    dateFrom = from;
    dateTo = to;
  } else {
    const m = parseInt(months) || 3;
    const d = new Date();
    dateTo = d.toISOString().split('T')[0];
    d.setMonth(d.getMonth() - m);
    dateFrom = d.toISOString().split('T')[0];
  }

  // Total spend
  const totalSpend = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM bank_transactions
    WHERE direction = 'OUT' AND date >= ? AND date <= ?
  `).get(dateFrom, dateTo);

  const totalIncome = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM bank_transactions
    WHERE direction = 'IN' AND date >= ? AND date <= ?
  `).get(dateFrom, dateTo);

  // Spend by category
  const byCategory = db.prepare(`
    SELECT COALESCE(ai_category, 'uncategorised') as category,
      SUM(amount) as total, COUNT(*) as count
    FROM bank_transactions
    WHERE direction = 'OUT' AND date >= ? AND date <= ?
    GROUP BY ai_category
    ORDER BY total DESC
  `).all(dateFrom, dateTo);

  // Spend by property
  const byProperty = db.prepare(`
    SELECT p.name as property_name, t.property_id,
      SUM(t.amount) as total, COUNT(*) as count
    FROM bank_transactions t
    LEFT JOIN properties p ON t.property_id = p.id
    WHERE t.direction = 'OUT' AND t.date >= ? AND t.date <= ? AND t.property_id IS NOT NULL
    GROUP BY t.property_id
    ORDER BY total DESC
  `).all(dateFrom, dateTo);

  // Monthly trend
  const monthlyTrend = db.prepare(`
    SELECT strftime('%Y-%m', date) as month,
      SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END) as spend,
      SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END) as income,
      COUNT(*) as txn_count
    FROM bank_transactions
    WHERE date >= ? AND date <= ?
    GROUP BY strftime('%Y-%m', date)
    ORDER BY month
  `).all(dateFrom, dateTo);

  // Spend by provider
  const byProvider = db.prepare(`
    SELECT ba.provider, ba.account_name,
      SUM(t.amount) as total, COUNT(*) as count
    FROM bank_transactions t
    JOIN bank_accounts ba ON t.bank_account_id = ba.id
    WHERE t.direction = 'OUT' AND t.date >= ? AND t.date <= ?
    GROUP BY t.bank_account_id
    ORDER BY total DESC
  `).all(dateFrom, dateTo);

  // Uncategorised count
  const uncategorised = db.prepare(`
    SELECT COUNT(*) as count FROM bank_transactions
    WHERE ai_category IS NULL AND direction = 'OUT' AND date >= ? AND date <= ?
  `).get(dateFrom, dateTo);

  // Top counterparties
  const topCounterparties = db.prepare(`
    SELECT counterparty, SUM(amount) as total, COUNT(*) as count
    FROM bank_transactions
    WHERE direction = 'OUT' AND date >= ? AND date <= ? AND counterparty != ''
    GROUP BY counterparty
    ORDER BY total DESC
    LIMIT 10
  `).all(dateFrom, dateTo);

  // Connected accounts
  const accounts = db.prepare(`
    SELECT id, provider, account_name, balance, last_sync_at, sync_enabled
    FROM bank_accounts ORDER BY created_at DESC
  `).all();

  // Maintenance-specific spend (property-related categories only)
  const maintenanceCategories = [
    'plumbing', 'electrical', 'joinery', 'roofing', 'cleaning',
    'gardening', 'pest_control', 'appliance_repair', 'locksmith',
    'painting_decorating', 'building_materials', 'safety_compliance',
    'general_maintenance', 'furnishing', 'waste_removal'
  ];
  const maintenancePlaceholders = maintenanceCategories.map(() => '?').join(',');
  const maintenanceSpend = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM bank_transactions
    WHERE direction = 'OUT' AND date >= ? AND date <= ?
    AND ai_category IN (${maintenancePlaceholders})
  `).get(dateFrom, dateTo, ...maintenanceCategories);

  res.json({
    period: { from: dateFrom, to: dateTo },
    totalSpend: totalSpend.total,
    totalIncome: totalIncome.total,
    maintenanceSpend: maintenanceSpend.total,
    uncategorisedCount: uncategorised.count,
    byCategory,
    byProperty,
    monthlyTrend,
    byProvider,
    topCounterparties,
    accounts
  });
});

// Category list for dropdowns
router.get('/categories', (req, res) => {
  res.json([
    { value: 'plumbing', label: 'Plumbing' },
    { value: 'electrical', label: 'Electrical' },
    { value: 'joinery', label: 'Joinery / Carpentry' },
    { value: 'roofing', label: 'Roofing' },
    { value: 'cleaning', label: 'Cleaning' },
    { value: 'gardening', label: 'Gardening' },
    { value: 'pest_control', label: 'Pest Control' },
    { value: 'appliance_repair', label: 'Appliance Repair' },
    { value: 'locksmith', label: 'Locksmith' },
    { value: 'painting_decorating', label: 'Painting & Decorating' },
    { value: 'building_materials', label: 'Building Materials' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'council_tax', label: 'Council Tax' },
    { value: 'utilities_gas', label: 'Utilities - Gas' },
    { value: 'utilities_electric', label: 'Utilities - Electric' },
    { value: 'utilities_water', label: 'Utilities - Water' },
    { value: 'mortgage', label: 'Mortgage' },
    { value: 'management_fee', label: 'Management Fee' },
    { value: 'legal', label: 'Legal' },
    { value: 'accounting', label: 'Accounting' },
    { value: 'furnishing', label: 'Furnishing' },
    { value: 'safety_compliance', label: 'Safety & Compliance' },
    { value: 'waste_removal', label: 'Waste Removal' },
    { value: 'general_maintenance', label: 'General Maintenance' },
    { value: 'staff_costs', label: 'Staff Costs' },
    { value: 'office_supplies', label: 'Office Supplies' },
    { value: 'software_subscriptions', label: 'Software & Subscriptions' },
    { value: 'marketing', label: 'Marketing' },
    { value: 'travel', label: 'Travel' },
    { value: 'non_property', label: 'Non-Property' },
    { value: 'personal', label: 'Personal' },
    { value: 'transfer', label: 'Transfer' },
    { value: 'unknown', label: 'Unknown' },
  ]);
});

module.exports = router;
