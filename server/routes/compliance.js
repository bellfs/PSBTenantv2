const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// File upload config
const uploadsDir = path.join(__dirname, '..', 'uploads', 'documents');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed`));
  }
});

// ===== COMPLIANCE CERTIFICATES =====

// Get all certificates (with optional property filter)
router.get('/certificates', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { property_id, status } = req.query;
    let query = `
      SELECT c.*, p.name as property_name, d.file_path as document_path, d.name as document_name
      FROM compliance_certificates c
      LEFT JOIN properties p ON c.property_id = p.id
      LEFT JOIN documents d ON c.document_id = d.id
    `;
    const conditions = [];
    const params = [];
    if (property_id) { conditions.push('c.property_id = ?'); params.push(property_id); }
    if (status === 'expired') { conditions.push("c.expiry_date < date('now')"); }
    else if (status === 'expiring') { conditions.push("c.expiry_date >= date('now') AND c.expiry_date <= date('now', '+30 days')"); }
    else if (status === 'valid') { conditions.push("(c.expiry_date > date('now', '+30 days') OR c.expiry_date IS NULL)"); }

    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY c.expiry_date ASC';
    res.json(db.prepare(query).all(...params));
  } finally { db.close(); }
});

// Get compliance summary (dashboard widget data)
router.get('/summary', authenticate, (req, res) => {
  const db = getDb();
  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM compliance_certificates').get().c;
    const expired = db.prepare("SELECT COUNT(*) as c FROM compliance_certificates WHERE expiry_date < date('now')").get().c;
    const expiringSoon = db.prepare("SELECT COUNT(*) as c FROM compliance_certificates WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+30 days')").get().c;
    const valid = total - expired - expiringSoon;

    const expiringList = db.prepare(`
      SELECT c.id, c.cert_type, c.expiry_date, p.name as property_name
      FROM compliance_certificates c LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.expiry_date <= date('now', '+60 days')
      ORDER BY c.expiry_date ASC LIMIT 10
    `).all();

    // Coverage: which properties are missing which cert types
    const requiredTypes = ['gas_safety', 'epc', 'eicr'];
    const properties = db.prepare('SELECT id, name FROM properties ORDER BY name').all();
    const coverage = properties.map(prop => {
      const certs = db.prepare('SELECT cert_type, expiry_date FROM compliance_certificates WHERE property_id = ?').all(prop.id);
      const certMap = {};
      certs.forEach(c => { certMap[c.cert_type] = c; });
      const missing = requiredTypes.filter(t => !certMap[t]);
      const expiredCerts = requiredTypes.filter(t => certMap[t] && certMap[t].expiry_date && certMap[t].expiry_date < new Date().toISOString().split('T')[0]);
      return { property_id: prop.id, property_name: prop.name, missing, expired: expiredCerts, total: certs.length };
    });

    res.json({ total, expired, expiring_soon: expiringSoon, valid, expiring_list: expiringList, coverage });
  } finally { db.close(); }
});

// Create certificate
router.post('/certificates', authenticate, requireAdmin, (req, res) => {
  const { property_id, cert_type, certificate_number, issued_date, expiry_date, provider, notes } = req.body;
  if (!property_id || !cert_type) return res.status(400).json({ error: 'property_id and cert_type required' });
  const db = getDb();
  try {
    const now = new Date().toISOString().split('T')[0];
    let status = 'valid';
    if (expiry_date) {
      if (expiry_date < now) status = 'expired';
      else {
        const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
        if (expiry_date <= thirtyDays) status = 'expiring_soon';
      }
    }
    const id = db.prepare(`
      INSERT INTO compliance_certificates (property_id, cert_type, certificate_number, issued_date, expiry_date, status, provider, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(property_id, cert_type, certificate_number || null, issued_date || null, expiry_date || null, status, provider || null, notes || null).lastInsertRowid;
    res.json({ id, status });
  } finally { db.close(); }
});

// Update certificate
router.put('/certificates/:id', authenticate, requireAdmin, (req, res) => {
  const { cert_type, certificate_number, issued_date, expiry_date, provider, notes, document_id } = req.body;
  const db = getDb();
  try {
    const now = new Date().toISOString().split('T')[0];
    let status = 'valid';
    if (expiry_date) {
      if (expiry_date < now) status = 'expired';
      else {
        const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
        if (expiry_date <= thirtyDays) status = 'expiring_soon';
      }
    }
    db.prepare(`
      UPDATE compliance_certificates SET cert_type = ?, certificate_number = ?, issued_date = ?, expiry_date = ?,
        status = ?, provider = ?, notes = ?, document_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cert_type, certificate_number || null, issued_date || null, expiry_date || null, status, provider || null, notes || null, document_id || null, req.params.id);
    res.json({ success: true, status });
  } finally { db.close(); }
});

// Delete certificate
router.delete('/certificates/:id', authenticate, requireAdmin, (req, res) => {
  const db = getDb();
  try {
    db.prepare('DELETE FROM compliance_certificates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } finally { db.close(); }
});

// ===== DOCUMENTS =====

// List documents (with optional filters)
router.get('/documents', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { property_id, tenant_id, category } = req.query;
    let query = `
      SELECT d.*, p.name as property_name, t.name as tenant_name
      FROM documents d
      LEFT JOIN properties p ON d.property_id = p.id
      LEFT JOIN tenants t ON d.tenant_id = t.id
    `;
    const conditions = [];
    const params = [];
    if (property_id) { conditions.push('d.property_id = ?'); params.push(property_id); }
    if (tenant_id) { conditions.push('d.tenant_id = ?'); params.push(tenant_id); }
    if (category) { conditions.push('d.category = ?'); params.push(category); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY d.created_at DESC';
    res.json(db.prepare(query).all(...params));
  } finally { db.close(); }
});

// Upload document
router.post('/documents', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { property_id, tenant_id, category, name, notes } = req.body;
  if (!category) return res.status(400).json({ error: 'Category required' });

  const db = getDb();
  try {
    const filePath = `/uploads/documents/${req.file.filename}`;
    const ext = path.extname(req.file.originalname).toLowerCase().slice(1);
    const id = db.prepare(`
      INSERT INTO documents (property_id, tenant_id, category, name, file_path, file_type, file_size, uploaded_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      property_id || null, tenant_id || null, category,
      name || req.file.originalname, filePath, ext, req.file.size,
      req.user.name, notes || null
    ).lastInsertRowid;
    res.json({ id, file_path: filePath, name: name || req.file.originalname });
  } finally { db.close(); }
});

// Delete document
router.delete('/documents/:id', authenticate, requireAdmin, (req, res) => {
  const db = getDb();
  try {
    const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(req.params.id);
    if (doc) {
      // Try to remove file from disk
      const fullPath = path.join(__dirname, '..', doc.file_path);
      try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) {}
      // Unlink from any certificates
      db.prepare('UPDATE compliance_certificates SET document_id = NULL WHERE document_id = ?').run(req.params.id);
      db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
    }
    res.json({ success: true });
  } finally { db.close(); }
});

module.exports = router;
