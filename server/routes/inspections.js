const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Photo upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'inspections');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `insp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// Standard rooms for a student flat
const DEFAULT_ROOMS = [
  'Hallway / Entrance',
  'Kitchen',
  'Living Room',
  'Bedroom 1',
  'Bedroom 2',
  'Bedroom 3',
  'Bathroom',
  'En-Suite',
  'Utility / Storage',
  'Exterior / Communal'
];

// Standard items per room
const DEFAULT_ITEMS = {
  'Hallway / Entrance': ['Front Door', 'Flooring', 'Walls', 'Ceiling', 'Light Fittings', 'Smoke Detector', 'Intercom/Buzzer'],
  'Kitchen': ['Oven/Hob', 'Extractor Fan', 'Fridge/Freezer', 'Dishwasher', 'Washing Machine', 'Sink & Taps', 'Worktops', 'Cupboards', 'Flooring', 'Walls', 'Ceiling', 'Light Fittings', 'Windows', 'Blind/Curtain'],
  'Living Room': ['Sofa/Seating', 'Table/Desk', 'Flooring', 'Walls', 'Ceiling', 'Light Fittings', 'Windows', 'Blind/Curtain', 'TV Aerial/Socket', 'Radiator'],
  'Bedroom 1': ['Bed Frame', 'Mattress', 'Wardrobe', 'Desk', 'Chair', 'Flooring', 'Walls', 'Ceiling', 'Light Fittings', 'Windows', 'Blind/Curtain', 'Radiator', 'Door & Lock'],
  'Bedroom 2': ['Bed Frame', 'Mattress', 'Wardrobe', 'Desk', 'Chair', 'Flooring', 'Walls', 'Ceiling', 'Light Fittings', 'Windows', 'Blind/Curtain', 'Radiator', 'Door & Lock'],
  'Bedroom 3': ['Bed Frame', 'Mattress', 'Wardrobe', 'Desk', 'Chair', 'Flooring', 'Walls', 'Ceiling', 'Light Fittings', 'Windows', 'Blind/Curtain', 'Radiator', 'Door & Lock'],
  'Bathroom': ['Bath/Shower', 'Toilet', 'Sink & Taps', 'Mirror/Cabinet', 'Extractor Fan', 'Flooring', 'Walls/Tiles', 'Ceiling', 'Light Fittings', 'Towel Rail', 'Door & Lock'],
  'En-Suite': ['Shower', 'Toilet', 'Sink & Taps', 'Mirror/Cabinet', 'Extractor Fan', 'Flooring', 'Walls/Tiles', 'Ceiling', 'Light Fittings', 'Door & Lock'],
  'Utility / Storage': ['Boiler', 'Fuse Board', 'Shelving', 'Flooring', 'Walls', 'Door'],
  'Exterior / Communal': ['Front Garden', 'Back Garden', 'Bins Area', 'Communal Hallway', 'Letterbox', 'External Doors']
};

// ===== LIST INSPECTIONS =====
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { type, property_id, status } = req.query;
    let query = `
      SELECT i.*, p.name as property_name, t.name as tenant_name, t.flat_number as tenant_flat
      FROM inspections i
      LEFT JOIN properties p ON i.property_id = p.id
      LEFT JOIN tenants t ON i.tenant_id = t.id
    `;
    const conditions = [];
    const params = [];
    if (type) { conditions.push('i.type = ?'); params.push(type); }
    if (property_id) { conditions.push('i.property_id = ?'); params.push(property_id); }
    if (status) { conditions.push('i.status = ?'); params.push(status); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY i.created_at DESC';
    res.json(db.prepare(query).all(...params));
  } finally { db.close(); }
});

// ===== GET SINGLE INSPECTION WITH FULL DETAILS =====
router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  try {
    const inspection = db.prepare(`
      SELECT i.*, p.name as property_name, p.address as property_address, p.postcode as property_postcode,
        t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone, t.flat_number as tenant_flat
      FROM inspections i
      LEFT JOIN properties p ON i.property_id = p.id
      LEFT JOIN tenants t ON i.tenant_id = t.id
      WHERE i.id = ?
    `).get(req.params.id);
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    const rooms = db.prepare('SELECT * FROM inspection_rooms WHERE inspection_id = ? ORDER BY room_order, id').all(req.params.id);
    for (const room of rooms) {
      room.items = db.prepare('SELECT * FROM inspection_items WHERE room_id = ? ORDER BY id').all(room.id);
      room.photos = db.prepare('SELECT * FROM inspection_photos WHERE room_id = ? ORDER BY uploaded_at').all(room.id);
    }

    const photos = db.prepare('SELECT * FROM inspection_photos WHERE inspection_id = ? ORDER BY uploaded_at').all(req.params.id);
    const deductions = db.prepare(`
      SELECT d.*, ii.item_name, ir.room_name
      FROM inspection_deductions d
      LEFT JOIN inspection_items ii ON d.item_id = ii.id
      LEFT JOIN inspection_rooms ir ON ii.room_id = ir.id
      WHERE d.inspection_id = ?
      ORDER BY d.id
    `).all(req.params.id);

    // For check-out, get the linked check-in data
    let checkinData = null;
    if (inspection.type === 'check_out' && inspection.linked_checkin_id) {
      const checkin = db.prepare('SELECT * FROM inspections WHERE id = ?').get(inspection.linked_checkin_id);
      if (checkin) {
        const checkinRooms = db.prepare('SELECT * FROM inspection_rooms WHERE inspection_id = ? ORDER BY room_order, id').all(checkin.id);
        for (const room of checkinRooms) {
          room.items = db.prepare('SELECT * FROM inspection_items WHERE room_id = ? ORDER BY id').all(room.id);
          room.photos = db.prepare('SELECT * FROM inspection_photos WHERE room_id = ? ORDER BY uploaded_at').all(room.id);
        }
        checkinData = { ...checkin, rooms: checkinRooms };
      }
    }

    res.json({ inspection, rooms, photos, deductions, checkinData });
  } finally { db.close(); }
});

// ===== CREATE INSPECTION =====
router.post('/', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { type, property_id, flat_number, tenant_id, tenancy_id, inspection_date, notes, deposit_amount, linked_checkin_id, rooms } = req.body;
    if (!type || !property_id || !inspection_date) {
      return res.status(400).json({ error: 'type, property_id and inspection_date are required' });
    }

    const result = db.prepare(`
      INSERT INTO inspections (type, property_id, flat_number, tenant_id, tenancy_id, performed_by, inspection_date, notes, deposit_amount, linked_checkin_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress')
    `).run(type, property_id, flat_number || null, tenant_id || null, tenancy_id || null, req.user.name, inspection_date, notes || null, deposit_amount || null, linked_checkin_id || null);

    const inspectionId = result.lastInsertRowid;

    // Create rooms with default items
    const roomList = rooms || DEFAULT_ROOMS;
    const insertRoom = db.prepare('INSERT INTO inspection_rooms (inspection_id, room_name, room_order) VALUES (?, ?, ?)');
    const insertItem = db.prepare('INSERT INTO inspection_items (room_id, item_name, condition) VALUES (?, ?, ?)');

    for (let i = 0; i < roomList.length; i++) {
      const roomName = typeof roomList[i] === 'string' ? roomList[i] : roomList[i].name;
      const roomResult = insertRoom.run(inspectionId, roomName, i);
      const roomId = roomResult.lastInsertRowid;

      // Add default items for this room type
      const items = DEFAULT_ITEMS[roomName] || [];
      for (const itemName of items) {
        // For check-out linked to check-in, pre-fill checkin_condition
        let checkinCondition = null;
        if (type === 'check_out' && linked_checkin_id) {
          const checkinItem = db.prepare(`
            SELECT ii.condition FROM inspection_items ii
            JOIN inspection_rooms ir ON ii.room_id = ir.id
            WHERE ir.inspection_id = ? AND ir.room_name = ? AND ii.item_name = ?
          `).get(linked_checkin_id, roomName, itemName);
          if (checkinItem) checkinCondition = checkinItem.condition;
        }
        const itemResult = insertItem.run(roomId, itemName, 'good');
        if (checkinCondition) {
          db.prepare('UPDATE inspection_items SET checkin_condition = ? WHERE id = ?').run(checkinCondition, itemResult.lastInsertRowid);
        }
      }
    }

    res.json({ id: inspectionId });
  } finally { db.close(); }
});

// ===== UPDATE INSPECTION =====
router.put('/:id', authenticate, (req, res) => {
  const db = getDb();
  try {
    const inspection = db.prepare('SELECT * FROM inspections WHERE id = ?').get(req.params.id);
    if (!inspection) return res.status(404).json({ error: 'Not found' });

    const { status, notes, meter_gas, meter_electric, meter_water, key_count, key_notes, deposit_amount, tenant_id, flat_number, deposit_scheme, deposit_ref, cleaning_standard } = req.body;
    db.prepare(`
      UPDATE inspections SET
        status = COALESCE(?, status),
        notes = COALESCE(?, notes),
        meter_gas = COALESCE(?, meter_gas),
        meter_electric = COALESCE(?, meter_electric),
        meter_water = COALESCE(?, meter_water),
        key_count = COALESCE(?, key_count),
        key_notes = COALESCE(?, key_notes),
        deposit_amount = COALESCE(?, deposit_amount),
        tenant_id = COALESCE(?, tenant_id),
        flat_number = COALESCE(?, flat_number),
        deposit_scheme = COALESCE(?, deposit_scheme),
        deposit_ref = COALESCE(?, deposit_ref),
        cleaning_standard = COALESCE(?, cleaning_standard),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status || null, notes || null, meter_gas || null, meter_electric || null, meter_water || null, key_count || null, key_notes || null, deposit_amount || null, tenant_id || null, flat_number || null, deposit_scheme || null, deposit_ref || null, cleaning_standard || null, req.params.id);

    // Recalculate deposit return if deposit_amount changed
    if (deposit_amount !== undefined) {
      const total = db.prepare('SELECT COALESCE(SUM(cost), 0) as total FROM inspection_deductions WHERE inspection_id = ?').get(req.params.id).total;
      const depositReturn = Math.max(0, (parseFloat(deposit_amount) || 0) - total);
      db.prepare('UPDATE inspections SET total_deductions = ?, deposit_return = ? WHERE id = ?').run(total, depositReturn, req.params.id);
    }

    res.json({ success: true });
  } finally { db.close(); }
});

// ===== UPDATE ITEM CONDITION =====
router.put('/items/:itemId', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { condition, description, is_damaged, repair_cost, repair_notes } = req.body;
    db.prepare(`
      UPDATE inspection_items SET
        condition = COALESCE(?, condition),
        description = COALESCE(?, description),
        is_damaged = COALESCE(?, is_damaged),
        repair_cost = COALESCE(?, repair_cost),
        repair_notes = COALESCE(?, repair_notes)
      WHERE id = ?
    `).run(condition || null, description || null, is_damaged ?? null, repair_cost ?? null, repair_notes || null, req.params.itemId);
    res.json({ success: true });
  } finally { db.close(); }
});

// ===== ADD ROOM =====
router.post('/:id/rooms', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { room_name } = req.body;
    const maxOrder = db.prepare('SELECT MAX(room_order) as m FROM inspection_rooms WHERE inspection_id = ?').get(req.params.id)?.m || 0;
    const result = db.prepare('INSERT INTO inspection_rooms (inspection_id, room_name, room_order) VALUES (?, ?, ?)').run(req.params.id, room_name, maxOrder + 1);
    res.json({ id: result.lastInsertRowid });
  } finally { db.close(); }
});

// ===== ADD ITEM TO ROOM =====
router.post('/rooms/:roomId/items', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { item_name, condition } = req.body;
    const result = db.prepare('INSERT INTO inspection_items (room_id, item_name, condition) VALUES (?, ?, ?)').run(req.params.roomId, item_name, condition || 'good');
    res.json({ id: result.lastInsertRowid });
  } finally { db.close(); }
});

// ===== UPLOAD PHOTO =====
router.post('/:id/photos', authenticate, upload.single('photo'), (req, res) => {
  const db = getDb();
  try {
    const { room_id, item_id, caption, photo_type } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
    const filePath = `/uploads/inspections/${req.file.filename}`;
    const result = db.prepare(`
      INSERT INTO inspection_photos (inspection_id, room_id, item_id, file_path, caption, photo_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.id, room_id || null, item_id || null, filePath, caption || null, photo_type || 'condition');
    res.json({ id: result.lastInsertRowid, file_path: filePath });
  } finally { db.close(); }
});

// ===== DELETE PHOTO =====
router.delete('/photos/:photoId', authenticate, (req, res) => {
  const db = getDb();
  try {
    const photo = db.prepare('SELECT * FROM inspection_photos WHERE id = ?').get(req.params.photoId);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    // Delete file from disk
    const fullPath = path.join(__dirname, '..', photo.file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    db.prepare('DELETE FROM inspection_photos WHERE id = ?').run(req.params.photoId);
    res.json({ success: true });
  } finally { db.close(); }
});

// ===== SIGN INSPECTION =====
router.post('/:id/sign', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { signer, signature } = req.body; // signer: 'tenant' or 'staff', signature: base64 data URL
    if (!signer || !signature) return res.status(400).json({ error: 'signer and signature required' });

    if (signer === 'tenant') {
      db.prepare('UPDATE inspections SET tenant_signature = ?, tenant_signed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(signature, req.params.id);
    } else {
      db.prepare('UPDATE inspections SET staff_signature = ?, staff_signed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(signature, req.params.id);
    }

    // Check if both have signed — mark complete
    const insp = db.prepare('SELECT * FROM inspections WHERE id = ?').get(req.params.id);
    if (insp.tenant_signature && insp.staff_signature) {
      db.prepare("UPDATE inspections SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    } else {
      db.prepare("UPDATE inspections SET status = 'pending_signature', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    }

    res.json({ success: true });
  } finally { db.close(); }
});

// ===== MANAGE DEDUCTIONS (check-out) =====
router.post('/:id/deductions', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { item_id, description, category, cost, evidence_notes, item_age_years, item_lifespan_years, replacement_cost } = req.body;

    // Calculate apportioned cost using betterment principle
    let apportionedCost = cost || 0;
    if (item_age_years != null && item_lifespan_years && replacement_cost) {
      const remainingLife = Math.max(0, item_lifespan_years - item_age_years);
      const proportion = remainingLife / item_lifespan_years;
      apportionedCost = Math.round(replacement_cost * proportion * 100) / 100;
    }

    const result = db.prepare(`
      INSERT INTO inspection_deductions (inspection_id, item_id, description, category, cost, evidence_notes, item_age_years, item_lifespan_years, replacement_cost, apportioned_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, item_id || null, description, category || 'damage', apportionedCost, evidence_notes || null, item_age_years || null, item_lifespan_years || null, replacement_cost || null, apportionedCost);

    // Recalculate total deductions
    const total = db.prepare('SELECT COALESCE(SUM(cost), 0) as total FROM inspection_deductions WHERE inspection_id = ?').get(req.params.id).total;
    const insp = db.prepare('SELECT deposit_amount FROM inspections WHERE id = ?').get(req.params.id);
    const depositReturn = Math.max(0, (insp.deposit_amount || 0) - total);
    db.prepare('UPDATE inspections SET total_deductions = ?, deposit_return = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(total, depositReturn, req.params.id);

    res.json({ id: result.lastInsertRowid, total_deductions: total, deposit_return: depositReturn });
  } finally { db.close(); }
});

router.delete('/deductions/:deductionId', authenticate, (req, res) => {
  const db = getDb();
  try {
    const ded = db.prepare('SELECT * FROM inspection_deductions WHERE id = ?').get(req.params.deductionId);
    if (!ded) return res.status(404).json({ error: 'Deduction not found' });
    db.prepare('DELETE FROM inspection_deductions WHERE id = ?').run(req.params.deductionId);

    // Recalculate
    const total = db.prepare('SELECT COALESCE(SUM(cost), 0) as total FROM inspection_deductions WHERE inspection_id = ?').get(ded.inspection_id).total;
    const insp = db.prepare('SELECT deposit_amount FROM inspections WHERE id = ?').get(ded.inspection_id);
    const depositReturn = Math.max(0, (insp.deposit_amount || 0) - total);
    db.prepare('UPDATE inspections SET total_deductions = ?, deposit_return = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(total, depositReturn, ded.inspection_id);

    res.json({ success: true, total_deductions: total, deposit_return: depositReturn });
  } finally { db.close(); }
});

// ===== GENERATE PDF REPORT =====
router.get('/:id/report', authenticate, async (req, res) => {
  const db = getDb();
  try {
    const inspection = db.prepare(`
      SELECT i.*, p.name as property_name, p.address as property_address, p.postcode as property_postcode,
        t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone
      FROM inspections i
      LEFT JOIN properties p ON i.property_id = p.id
      LEFT JOIN tenants t ON i.tenant_id = t.id
      WHERE i.id = ?
    `).get(req.params.id);
    if (!inspection) return res.status(404).json({ error: 'Not found' });

    const rooms = db.prepare('SELECT * FROM inspection_rooms WHERE inspection_id = ? ORDER BY room_order, id').all(req.params.id);
    for (const room of rooms) {
      room.items = db.prepare('SELECT * FROM inspection_items WHERE room_id = ? ORDER BY id').all(room.id);
      room.photos = db.prepare('SELECT * FROM inspection_photos WHERE room_id = ? ORDER BY uploaded_at').all(room.id);
    }
    const deductions = db.prepare(`
      SELECT d.*, ii.item_name, ir.room_name
      FROM inspection_deductions d
      LEFT JOIN inspection_items ii ON d.item_id = ii.id
      LEFT JOIN inspection_rooms ir ON ii.room_id = ir.id
      WHERE d.inspection_id = ?
    `).all(req.params.id);
    const allPhotos = db.prepare('SELECT * FROM inspection_photos WHERE inspection_id = ? ORDER BY uploaded_at').all(req.params.id);

    // Build HTML report
    const html = buildReportHTML(inspection, rooms, deductions, allPhotos);

    // Return HTML — client can render as printable page or convert to PDF
    res.json({
      html,
      inspection,
      rooms,
      deductions,
      photos: allPhotos,
      summary: {
        total_items: rooms.reduce((s, r) => s + r.items.length, 0),
        damaged_items: rooms.reduce((s, r) => s + r.items.filter(i => i.is_damaged).length, 0),
        total_photos: allPhotos.length,
        total_deductions: inspection.total_deductions || 0,
        deposit_amount: inspection.deposit_amount || 0,
        deposit_return: inspection.deposit_return || 0,
      }
    });
  } finally { db.close(); }
});

// ===== GET COMPLETED CHECK-INS FOR A PROPERTY (for linking to check-out) =====
router.get('/property/:propertyId/checkins', authenticate, (req, res) => {
  const db = getDb();
  try {
    const checkins = db.prepare(`
      SELECT i.id, i.flat_number, i.inspection_date, i.status, t.name as tenant_name
      FROM inspections i
      LEFT JOIN tenants t ON i.tenant_id = t.id
      WHERE i.property_id = ? AND i.type = 'check_in' AND i.status = 'completed'
      ORDER BY i.inspection_date DESC
    `).all(req.params.propertyId);
    res.json(checkins);
  } finally { db.close(); }
});


function buildReportHTML(inspection, rooms, deductions, photos) {
  const isCheckOut = inspection.type === 'check_out';
  const title = isCheckOut ? 'CHECK-OUT INSPECTION REPORT' : 'CHECK-IN INSPECTION REPORT';
  const subtitle = isCheckOut ? 'Property Condition & Deposit Assessment' : 'Property Condition Report';

  const conditionColor = (c) => {
    const colors = { excellent: '#34d399', good: '#60a5fa', fair: '#fbbf24', poor: '#f87171', damaged: '#ef4444' };
    return colors[c] || '#9ca3af';
  };

  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title} - ${inspection.property_name}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; color: #1e293b; font-size: 12px; line-height: 1.5; }
  .page { max-width: 210mm; margin: 0 auto; padding: 20mm; }
  @media print {
    .page { padding: 15mm; }
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
  }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 3px solid #6366f1; padding-bottom: 16px; }
  .header h1 { font-size: 22px; font-weight: 800; color: #6366f1; letter-spacing: -0.02em; }
  .header p { font-size: 13px; color: #64748b; margin-top: 4px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
  .meta-box h3 { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
  .meta-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; }
  .meta-row .label { color: #64748b; }
  .meta-row .value { font-weight: 600; color: #1e293b; }
  .room-section { margin-bottom: 20px; }
  .room-title { font-size: 15px; font-weight: 700; color: #1e293b; padding: 8px 12px; background: #f1f5f9; border-radius: 6px; margin-bottom: 8px; border-left: 4px solid #6366f1; }
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .items-table th { text-align: left; padding: 6px 10px; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 2px solid #e2e8f0; }
  .items-table td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
  .condition-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
  .photo-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }
  .photo-grid img { width: 100%; height: 100px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; }
  .deductions-section { margin-top: 24px; padding: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; }
  .deductions-section h3 { font-size: 14px; font-weight: 700; color: #dc2626; margin-bottom: 12px; }
  .ded-table { width: 100%; border-collapse: collapse; }
  .ded-table th { text-align: left; padding: 6px 10px; font-size: 10px; font-weight: 700; color: #991b1b; text-transform: uppercase; border-bottom: 2px solid #fecaca; }
  .ded-table td { padding: 6px 10px; border-bottom: 1px solid #fee2e2; font-size: 12px; }
  .ded-total { display: flex; justify-content: space-between; padding: 12px 10px; border-top: 2px solid #dc2626; margin-top: 8px; font-size: 14px; font-weight: 800; color: #dc2626; }
  .deposit-summary { margin-top: 16px; padding: 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; }
  .deposit-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
  .deposit-row.total { border-top: 2px solid #22c55e; margin-top: 8px; padding-top: 8px; font-weight: 800; font-size: 15px; color: #16a34a; }
  .signature-section { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .signature-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
  .signature-box h4 { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 8px; }
  .signature-box img { max-height: 60px; margin-bottom: 4px; }
  .signature-box .signed-date { font-size: 10px; color: #64748b; }
  .footer { margin-top: 24px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>PSB PROPERTIES</h1>
    <p>${title}</p>
    <p>${subtitle}</p>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <h3>Property Details</h3>
      <div class="meta-row"><span class="label">Property</span><span class="value">${inspection.property_name || ''}</span></div>
      <div class="meta-row"><span class="label">Address</span><span class="value">${inspection.property_address || ''}</span></div>
      <div class="meta-row"><span class="label">Postcode</span><span class="value">${inspection.property_postcode || ''}</span></div>
      <div class="meta-row"><span class="label">Flat</span><span class="value">${inspection.flat_number || 'N/A'}</span></div>
    </div>
    <div class="meta-box">
      <h3>Inspection Details</h3>
      <div class="meta-row"><span class="label">Type</span><span class="value">${isCheckOut ? 'Check-Out' : 'Check-In'}</span></div>
      <div class="meta-row"><span class="label">Date</span><span class="value">${new Date(inspection.inspection_date).toLocaleDateString('en-GB')}</span></div>
      <div class="meta-row"><span class="label">Inspector</span><span class="value">${inspection.performed_by || ''}</span></div>
      <div class="meta-row"><span class="label">Tenant</span><span class="value">${inspection.tenant_name || 'N/A'}</span></div>
      ${isCheckOut && inspection.deposit_scheme ? `<div class="meta-row"><span class="label">Deposit Scheme</span><span class="value">${inspection.deposit_scheme}</span></div>` : ''}
      ${isCheckOut && inspection.deposit_ref ? `<div class="meta-row"><span class="label">Scheme Ref</span><span class="value">${inspection.deposit_ref}</span></div>` : ''}
    </div>
  </div>

  ${inspection.meter_gas || inspection.meter_electric || inspection.meter_water ? `
  <div class="meta-box" style="margin-bottom:16px;">
    <h3>Meter Readings</h3>
    ${inspection.meter_gas ? `<div class="meta-row"><span class="label">Gas</span><span class="value">${inspection.meter_gas}</span></div>` : ''}
    ${inspection.meter_electric ? `<div class="meta-row"><span class="label">Electric</span><span class="value">${inspection.meter_electric}</span></div>` : ''}
    ${inspection.meter_water ? `<div class="meta-row"><span class="label">Water</span><span class="value">${inspection.meter_water}</span></div>` : ''}
  </div>` : ''}

  ${inspection.key_count ? `
  <div class="meta-box" style="margin-bottom:16px;">
    <h3>Keys</h3>
    <div class="meta-row"><span class="label">Keys Provided</span><span class="value">${inspection.key_count}</span></div>
    ${inspection.key_notes ? `<div class="meta-row"><span class="label">Notes</span><span class="value">${inspection.key_notes}</span></div>` : ''}
  </div>` : ''}
`;

  // Room-by-room details
  for (const room of rooms) {
    html += `
  <div class="room-section">
    <div class="room-title">${room.room_name}</div>
    <table class="items-table">
      <thead><tr>
        <th>Item</th>
        <th>Condition</th>
        ${isCheckOut ? '<th>At Check-In</th>' : ''}
        <th>Notes</th>
        ${isCheckOut ? '<th>Repair Cost</th>' : ''}
      </tr></thead>
      <tbody>`;

    for (const item of room.items) {
      html += `
        <tr>
          <td style="font-weight:500;">${item.item_name}</td>
          <td><span class="condition-badge" style="background:${conditionColor(item.condition)}22;color:${conditionColor(item.condition)}">${item.condition}</span></td>
          ${isCheckOut ? `<td><span class="condition-badge" style="background:${conditionColor(item.checkin_condition)}22;color:${conditionColor(item.checkin_condition)}">${item.checkin_condition || '-'}</span></td>` : ''}
          <td>${item.description || '-'}</td>
          ${isCheckOut && item.repair_cost > 0 ? `<td style="font-weight:600;color:#dc2626">&pound;${item.repair_cost.toFixed(2)}</td>` : isCheckOut ? '<td>-</td>' : ''}
        </tr>`;
    }

    html += `</tbody></table>`;

    // Room photos
    if (room.photos.length > 0) {
      html += `<div class="photo-grid">`;
      for (const photo of room.photos) {
        html += `<img src="${photo.file_path}" alt="${photo.caption || room.room_name}" />`;
      }
      html += `</div>`;
    }

    html += `</div>`;
  }

  // Deductions section (check-out only)
  if (isCheckOut && deductions.length > 0) {
    html += `
  <div class="deductions-section">
    <h3>Deposit Deductions</h3>
    <p style="font-size:11px;color:#64748b;margin-bottom:12px;">Deductions calculated in accordance with the betterment principle. Tenants are only charged for the remaining useful life of items, not full replacement cost.</p>
    <table class="ded-table">
      <thead><tr>
        <th>Item</th>
        <th>Description</th>
        <th>Category</th>
        <th>Apportionment</th>
        <th style="text-align:right">Cost</th>
      </tr></thead>
      <tbody>`;

    for (const d of deductions) {
      const hasApportionment = d.item_age_years != null && d.item_lifespan_years;
      html += `
        <tr>
          <td>${d.room_name ? `${d.room_name} - ${d.item_name}` : (d.item_name || 'General')}</td>
          <td>${d.description}</td>
          <td style="text-transform:capitalize">${(d.category || '').replace(/_/g, ' ')}</td>
          <td style="font-size:10px;color:#64748b;">${hasApportionment ? `${d.item_age_years}yr old / ${d.item_lifespan_years}yr life &bull; £${(d.replacement_cost || 0).toFixed(0)} replacement` : '-'}</td>
          <td style="text-align:right;font-weight:600">&pound;${d.cost.toFixed(2)}</td>
        </tr>`;
    }

    html += `</tbody></table>
    <div class="ded-total">
      <span>Total Deductions</span>
      <span>&pound;${(inspection.total_deductions || 0).toFixed(2)}</span>
    </div>
  </div>

  <div class="deposit-summary">
    <div class="deposit-row"><span>Deposit Held</span><span style="font-weight:600">&pound;${(inspection.deposit_amount || 0).toFixed(2)}</span></div>
    <div class="deposit-row"><span>Total Deductions</span><span style="font-weight:600;color:#dc2626">-&pound;${(inspection.total_deductions || 0).toFixed(2)}</span></div>
    <div class="deposit-row total"><span>Amount to Return</span><span>&pound;${(inspection.deposit_return || 0).toFixed(2)}</span></div>
  </div>`;
  }

  // Signatures
  html += `
  <div class="signature-section">
    <div class="signature-box">
      <h4>Tenant Signature</h4>
      ${inspection.tenant_signature ? `<img src="${inspection.tenant_signature}" alt="Tenant signature" /><div class="signed-date">Signed: ${inspection.tenant_signed_at ? new Date(inspection.tenant_signed_at).toLocaleString('en-GB') : ''}</div>` : '<p style="color:#94a3b8;padding:20px 0">Not yet signed</p>'}
    </div>
    <div class="signature-box">
      <h4>Staff Signature</h4>
      ${inspection.staff_signature ? `<img src="${inspection.staff_signature}" alt="Staff signature" /><div class="signed-date">Signed: ${inspection.staff_signed_at ? new Date(inspection.staff_signed_at).toLocaleString('en-GB') : ''}</div>` : '<p style="color:#94a3b8;padding:20px 0">Not yet signed</p>'}
    </div>
  </div>

  ${inspection.notes ? `<div class="meta-box" style="margin-top:16px;"><h3>Additional Notes</h3><p style="font-size:12px;padding:4px 0;">${inspection.notes}</p></div>` : ''}

  <div class="footer">
    <p><strong>PSB Properties</strong> &mdash; ${title}</p>
    <p>Generated ${new Date().toLocaleString('en-GB')} | Reference: INS-${String(inspection.id).padStart(4, '0')}</p>
    ${isCheckOut && inspection.deposit_scheme ? `<p>Deposit protected with: ${inspection.deposit_scheme}${inspection.deposit_ref ? ` (Ref: ${inspection.deposit_ref})` : ''}</p>` : ''}
    <p>This report is provided as evidence for deposit protection scheme adjudication in accordance with the Housing Act 2004.</p>
    <p>All deductions are calculated using the betterment principle. Fair wear and tear has been considered.</p>
  </div>
</div>
</body>
</html>`;

  return html;
}

module.exports = router;
