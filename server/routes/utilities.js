const express = require('express');
const { getDb } = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ===== READINGS =====
router.get('/readings', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { year, property_id, meter_type, property_name } = req.query;
    let query = `
      SELECT mr.*, p.name as parent_property_name
      FROM meter_readings mr
      LEFT JOIN properties p ON mr.property_id = p.id
      WHERE 1=1
    `;
    const params = [];
    if (year) { query += ' AND mr.year = ?'; params.push(parseInt(year)); }
    if (property_id) { query += ' AND mr.property_id = ?'; params.push(parseInt(property_id)); }
    if (meter_type) { query += ' AND mr.meter_type = ?'; params.push(meter_type); }
    if (property_name) { query += ' AND mr.property_name = ?'; params.push(property_name); }
    query += ' ORDER BY mr.year DESC, mr.month DESC, mr.property_name';
    res.json(db.prepare(query).all(...params));
  } finally { db.close(); }
});

router.post('/readings', authenticate, (req, res) => {
  const { property_id, property_name, meter_type, mprn, mpan, water_ref, month, year, reading, usage_kwh, cost, change_vs_prev } = req.body;
  if (!property_id || !meter_type || !month || !year) {
    return res.status(400).json({ error: 'property_id, meter_type, month, and year are required' });
  }
  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO meter_readings (property_id, property_name, meter_type, mprn, mpan, water_ref, month, year, reading, usage_kwh, cost, change_vs_prev)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(property_id, meter_type, month, year, property_name) DO UPDATE SET
        reading = excluded.reading,
        usage_kwh = excluded.usage_kwh,
        cost = excluded.cost,
        change_vs_prev = excluded.change_vs_prev,
        mprn = excluded.mprn,
        mpan = excluded.mpan,
        water_ref = excluded.water_ref
    `).run(
      property_id, property_name || null, meter_type, mprn || null, mpan || null, water_ref || null,
      month, year, reading || null, usage_kwh || 0, cost || 0, change_vs_prev || 0
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } finally { db.close(); }
});

router.post('/readings/bulk', authenticate, (req, res) => {
  const { readings } = req.body;
  if (!Array.isArray(readings) || readings.length === 0) {
    return res.status(400).json({ error: 'readings array is required' });
  }
  const db = getDb();
  try {
    const stmt = db.prepare(`
      INSERT INTO meter_readings (property_id, property_name, meter_type, mprn, mpan, water_ref, month, year, reading, usage_kwh, cost, change_vs_prev)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(property_id, meter_type, month, year, property_name) DO UPDATE SET
        reading = excluded.reading,
        usage_kwh = excluded.usage_kwh,
        cost = excluded.cost,
        change_vs_prev = excluded.change_vs_prev,
        mprn = excluded.mprn,
        mpan = excluded.mpan,
        water_ref = excluded.water_ref
    `);
    let count = 0;
    for (const r of readings) {
      if (!r.property_id || !r.meter_type || !r.month || !r.year) continue;
      stmt.run(
        r.property_id, r.property_name || null, r.meter_type, r.mprn || null, r.mpan || null, r.water_ref || null,
        r.month, r.year, r.reading || null, r.usage_kwh || 0, r.cost || 0, r.change_vs_prev || 0
      );
      count++;
    }
    res.json({ success: true, count });
  } finally { db.close(); }
});

// ===== RATES =====
router.get('/rates', authenticate, (req, res) => {
  const db = getDb();
  try {
    const { property_id, property_name } = req.query;
    const rates = db.prepare(`
      SELECT ur.*, p.name as parent_property_name
      FROM utility_rates ur
      LEFT JOIN properties p ON ur.property_id = p.id
      WHERE (ur.effective_to IS NULL OR ur.effective_to >= date('now'))
      ORDER BY ur.property_id NULLS FIRST, ur.rate_type, ur.effective_from DESC
    `).all();

    // Build current rates: global defaults, then per-property overrides
    const current = {};       // global defaults (property_id IS NULL)
    const byProperty = {};    // { "propId:propName": { rate_type: value } }

    for (const r of rates) {
      const key = r.property_id ? `${r.property_id}:${r.property_name || ''}` : null;
      if (!key) {
        // Global rate
        if (!current[r.rate_type]) current[r.rate_type] = r.rate_value;
      } else {
        // Per-property rate
        if (!byProperty[key]) byProperty[key] = {};
        if (!byProperty[key][r.rate_type]) byProperty[key][r.rate_type] = r.rate_value;
      }
    }

    // If a specific property is requested, merge global + property-specific
    let propertyRates = null;
    if (property_id) {
      const pKey = `${property_id}:${property_name || ''}`;
      propertyRates = { ...current, ...(byProperty[pKey] || {}) };
    }

    res.json({ rates, current, byProperty, propertyRates });
  } finally { db.close(); }
});

router.post('/rates', authenticate, (req, res) => {
  const { rate_type, rate_value, effective_from, effective_to, notes, property_id, property_name } = req.body;
  if (!rate_type || rate_value == null || !effective_from) {
    return res.status(400).json({ error: 'rate_type, rate_value, and effective_from are required' });
  }
  const db = getDb();
  try {
    // If setting a property-specific rate, expire any existing rate of same type for same property
    if (property_id) {
      db.prepare(`
        UPDATE utility_rates SET effective_to = ?
        WHERE rate_type = ? AND property_id = ? AND COALESCE(property_name, '') = COALESCE(?, '')
          AND effective_to IS NULL
      `).run(effective_from, rate_type, property_id, property_name || '');
    } else {
      // Expire global rate of same type
      db.prepare(`
        UPDATE utility_rates SET effective_to = ?
        WHERE rate_type = ? AND property_id IS NULL AND effective_to IS NULL
      `).run(effective_from, rate_type);
    }

    const id = db.prepare(
      'INSERT INTO utility_rates (rate_type, rate_value, effective_from, effective_to, property_id, property_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(rate_type, rate_value, effective_from, effective_to || null, property_id || null, property_name || null, notes || null).lastInsertRowid;
    res.json({ success: true, id });
  } finally { db.close(); }
});

// ===== ANALYTICS =====
router.get('/analytics', authenticate, (req, res) => {
  const db = getDb();
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const property_id = req.query.property_id ? parseInt(req.query.property_id) : null;

    let propFilter = '';
    const propParams = [];
    if (property_id) { propFilter = ' AND mr.property_id = ?'; propParams.push(property_id); }

    // Monthly costs per property
    const monthlyCosts = db.prepare(`
      SELECT mr.property_id, mr.property_name, mr.meter_type, mr.month, mr.year,
        mr.usage_kwh, mr.cost, mr.reading, p.name as parent_property_name
      FROM meter_readings mr
      LEFT JOIN properties p ON mr.property_id = p.id
      WHERE mr.year = ? ${propFilter}
      ORDER BY mr.month, mr.property_name
    `).all(year, ...propParams);

    // Totals by property (gas + electric combined)
    const propertyTotals = db.prepare(`
      SELECT mr.property_id, COALESCE(mr.property_name, p.name) as display_name,
        SUM(CASE WHEN mr.meter_type = 'gas' THEN mr.cost ELSE 0 END) as total_gas_cost,
        SUM(CASE WHEN mr.meter_type = 'electric' THEN mr.cost ELSE 0 END) as total_electric_cost,
        SUM(mr.cost) as total_cost,
        SUM(CASE WHEN mr.meter_type = 'gas' THEN mr.usage_kwh ELSE 0 END) as total_gas_kwh,
        SUM(CASE WHEN mr.meter_type = 'electric' THEN mr.usage_kwh ELSE 0 END) as total_electric_kwh,
        SUM(mr.usage_kwh) as total_kwh
      FROM meter_readings mr
      LEFT JOIN properties p ON mr.property_id = p.id
      WHERE mr.year = ? ${propFilter}
      GROUP BY mr.property_id, mr.property_name
      ORDER BY total_cost DESC
    `).all(year, ...propParams);

    // Monthly trends (sum across all properties in scope)
    const monthlyTrends = db.prepare(`
      SELECT mr.month, mr.meter_type,
        SUM(mr.usage_kwh) as total_kwh,
        SUM(mr.cost) as total_cost
      FROM meter_readings mr
      WHERE mr.year = ? ${propFilter}
      GROUP BY mr.month, mr.meter_type
      ORDER BY mr.month
    `).all(year, ...propParams);

    // Gas vs electric spend breakdown
    const spendBreakdown = db.prepare(`
      SELECT mr.meter_type,
        SUM(mr.usage_kwh) as total_kwh,
        SUM(mr.cost) as total_cost
      FROM meter_readings mr
      WHERE mr.year = ? ${propFilter}
      GROUP BY mr.meter_type
    `).all(year, ...propParams);

    // Cumulative costs by month
    const cumulativeData = [];
    let cumGas = 0, cumElec = 0;
    for (let m = 1; m <= 12; m++) {
      const monthData = monthlyCosts.filter(r => r.month === m);
      const gasTotal = monthData.filter(r => r.meter_type === 'gas').reduce((s, r) => s + r.cost, 0);
      const elecTotal = monthData.filter(r => r.meter_type === 'electric').reduce((s, r) => s + r.cost, 0);
      cumGas += gasTotal;
      cumElec += elecTotal;
      if (gasTotal > 0 || elecTotal > 0) {
        cumulativeData.push({ month: m, gas_cost: gasTotal, electric_cost: elecTotal, cumulative_gas: cumGas, cumulative_electric: cumElec, cumulative_total: cumGas + cumElec });
      }
    }

    // Year-on-year comparison
    const prevYear = year - 1;
    const yoyComparison = db.prepare(`
      SELECT mr.month,
        SUM(CASE WHEN mr.year = ? THEN mr.cost ELSE 0 END) as current_year_cost,
        SUM(CASE WHEN mr.year = ? THEN mr.cost ELSE 0 END) as prev_year_cost,
        SUM(CASE WHEN mr.year = ? THEN mr.usage_kwh ELSE 0 END) as current_year_kwh,
        SUM(CASE WHEN mr.year = ? THEN mr.usage_kwh ELSE 0 END) as prev_year_kwh
      FROM meter_readings mr
      WHERE mr.year IN (?, ?) ${propFilter} ${propFilter ? propFilter : ''}
      GROUP BY mr.month
      ORDER BY mr.month
    `).all(year, prevYear, year, prevYear, year, prevYear, ...propParams, ...propParams);

    // Most expensive months
    const expensiveMonths = db.prepare(`
      SELECT mr.month, mr.year, SUM(mr.cost) as total_cost
      FROM meter_readings mr
      WHERE 1=1 ${propFilter}
      GROUP BY mr.year, mr.month
      ORDER BY total_cost DESC
      LIMIT 5
    `).all(...propParams);

    // Future projections (linear regression on available data)
    const recentMonths = db.prepare(`
      SELECT mr.month, mr.year, SUM(mr.cost) as total_cost, SUM(mr.usage_kwh) as total_kwh
      FROM meter_readings mr
      WHERE 1=1 ${propFilter}
      GROUP BY mr.year, mr.month
      ORDER BY mr.year DESC, mr.month DESC
      LIMIT 6
    `).all(...propParams);

    let projections = [];
    if (recentMonths.length >= 2) {
      // Simple linear regression
      const n = recentMonths.length;
      const xs = recentMonths.map((_, i) => i);
      const ys = recentMonths.map(r => r.total_cost);
      const xMean = xs.reduce((a, b) => a + b, 0) / n;
      const yMean = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += (xs[i] - xMean) * (ys[i] - yMean);
        den += (xs[i] - xMean) * (xs[i] - xMean);
      }
      const slope = den !== 0 ? num / den : 0;
      const intercept = yMean - slope * xMean;

      // Project next 3 months
      const lastEntry = recentMonths[0];
      let projMonth = lastEntry.month;
      let projYear = lastEntry.year;
      for (let i = 1; i <= 3; i++) {
        projMonth++;
        if (projMonth > 12) { projMonth = 1; projYear++; }
        const projCost = Math.max(0, intercept + slope * (n - 1 + i));
        projections.push({ month: projMonth, year: projYear, projected_cost: Math.round(projCost * 100) / 100 });
      }
    }

    // Property leaderboard by usage
    const leaderboard = db.prepare(`
      SELECT mr.property_id, COALESCE(mr.property_name, p.name) as display_name,
        SUM(mr.usage_kwh) as total_kwh, SUM(mr.cost) as total_cost,
        SUM(CASE WHEN mr.meter_type = 'gas' THEN mr.usage_kwh ELSE 0 END) as gas_kwh,
        SUM(CASE WHEN mr.meter_type = 'electric' THEN mr.usage_kwh ELSE 0 END) as electric_kwh
      FROM meter_readings mr
      LEFT JOIN properties p ON mr.property_id = p.id
      WHERE mr.year = ? ${propFilter}
      GROUP BY mr.property_id, mr.property_name
      ORDER BY total_kwh DESC
    `).all(year, ...propParams);

    res.json({
      year,
      monthlyCosts,
      propertyTotals,
      monthlyTrends,
      spendBreakdown,
      cumulativeData,
      yoyComparison,
      expensiveMonths,
      projections,
      leaderboard,
    });
  } finally { db.close(); }
});

// ===== ALERTS =====
router.get('/alerts', authenticate, (req, res) => {
  const db = getDb();
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const alerts = db.prepare(`
      SELECT ua.*, p.name as parent_property_name
      FROM utility_alerts ua
      LEFT JOIN properties p ON ua.property_id = p.id
      WHERE ua.year = ?
      ORDER BY ua.created_at DESC
    `).all(year);
    res.json(alerts);
  } finally { db.close(); }
});

// ===== FAIR USAGE =====
router.get('/fair-usage', authenticate, (req, res) => {
  const db = getDb();
  try {
    const limits = db.prepare(`
      SELECT fu.*, p.name as property_name_display
      FROM fair_usage_limits fu
      LEFT JOIN properties p ON fu.property_id = p.id
      ORDER BY p.name, fu.meter_type
    `).all();
    res.json(limits);
  } finally { db.close(); }
});

router.post('/fair-usage', authenticate, (req, res) => {
  const { property_id, meter_type, monthly_limit_kwh, academic_year } = req.body;
  if (!property_id || !meter_type) {
    return res.status(400).json({ error: 'property_id and meter_type are required' });
  }
  const db = getDb();
  try {
    const yr = academic_year || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
    db.prepare(`
      INSERT INTO fair_usage_limits (property_id, meter_type, monthly_limit_kwh, academic_year)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(property_id, meter_type, academic_year) DO UPDATE SET
        monthly_limit_kwh = excluded.monthly_limit_kwh
    `).run(property_id, meter_type, monthly_limit_kwh || 0, yr);
    res.json({ success: true });
  } finally { db.close(); }
});

// ===== CHECK OVERUSAGE =====
router.post('/check-overusage', authenticate, async (req, res) => {
  const { month, year } = req.body;
  if (!month || !year) {
    return res.status(400).json({ error: 'month and year are required' });
  }
  const db = getDb();
  try {
    // Get all readings for the given month
    const readings = db.prepare(`
      SELECT mr.*, p.name as parent_property_name
      FROM meter_readings mr
      LEFT JOIN properties p ON mr.property_id = p.id
      WHERE mr.month = ? AND mr.year = ?
    `).all(month, year);

    const alerts = [];
    const THRESHOLD_PCT = 120;

    for (const reading of readings) {
      // Check fair usage limit first
      const limit = db.prepare(`
        SELECT monthly_limit_kwh FROM fair_usage_limits
        WHERE property_id = ? AND meter_type = ?
        ORDER BY academic_year DESC LIMIT 1
      `).get(reading.property_id, reading.meter_type);

      let avgUsage;
      if (limit && limit.monthly_limit_kwh > 0) {
        avgUsage = limit.monthly_limit_kwh;
      } else {
        // Fall back to historical average (exclude current month)
        const avg = db.prepare(`
          SELECT AVG(usage_kwh) as avg_kwh FROM meter_readings
          WHERE property_id = ? AND meter_type = ?
            AND COALESCE(property_name, '') = COALESCE(?, '')
            AND NOT (month = ? AND year = ?)
            AND usage_kwh > 0
        `).get(reading.property_id, reading.meter_type, reading.property_name || '', month, year);
        avgUsage = avg?.avg_kwh || 0;
      }

      if (avgUsage <= 0 || reading.usage_kwh <= 0) continue;

      const pct = (reading.usage_kwh / avgUsage) * 100;
      if (pct >= THRESHOLD_PCT) {
        // Check if alert already exists
        const existing = db.prepare(`
          SELECT id FROM utility_alerts
          WHERE property_id = ? AND meter_type = ? AND month = ? AND year = ?
        `).get(reading.property_id, reading.meter_type, month, year);

        if (!existing) {
          db.prepare(`
            INSERT INTO utility_alerts (property_id, meter_type, month, year, usage_kwh, avg_usage, threshold_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(reading.property_id, reading.meter_type, month, year, reading.usage_kwh, avgUsage, THRESHOLD_PCT);

          alerts.push({
            property_name: reading.property_name || reading.parent_property_name,
            meter_type: reading.meter_type,
            usage_kwh: reading.usage_kwh,
            avg_usage: avgUsage,
            pct: Math.round(pct),
          });
        }
      }
    }

    // Send email notification if there are alerts
    if (alerts.length > 0) {
      try {
        const { sendOverusageAlert } = require('./utilities-email');
        await sendOverusageAlert(alerts, month, year);
      } catch (emailErr) {
        // If email helper doesn't exist or fails, try direct nodemailer
        try {
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          });

          const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
          const alertRows = alerts.map(a =>
            `<tr><td style="padding:8px;border:1px solid #ddd">${a.property_name}</td>` +
            `<td style="padding:8px;border:1px solid #ddd">${a.meter_type}</td>` +
            `<td style="padding:8px;border:1px solid #ddd">${a.usage_kwh.toFixed(1)} kWh</td>` +
            `<td style="padding:8px;border:1px solid #ddd">${a.avg_usage.toFixed(1)} kWh</td>` +
            `<td style="padding:8px;border:1px solid #ddd;color:#c62828;font-weight:bold">${a.pct}%</td></tr>`
          ).join('');

          await transporter.sendMail({
            from: process.env.SMTP_USER || 'noreply@52oldelvet.com',
            to: process.env.ESCALATION_EMAIL || 'admin@52oldelvet.com',
            subject: `Utility Overusage Alert - ${monthNames[month]} ${year}`,
            html: `
              <h2 style="color:#c62828">Utility Overusage Alert</h2>
              <p>The following properties exceeded ${THRESHOLD_PCT}% of their usage limit/average for ${monthNames[month]} ${year}:</p>
              <table style="border-collapse:collapse;width:100%">
                <tr style="background:#f5f5f5">
                  <th style="padding:8px;border:1px solid #ddd;text-align:left">Property</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left">Type</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left">Usage</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left">Avg/Limit</th>
                  <th style="padding:8px;border:1px solid #ddd;text-align:left">% of Limit</th>
                </tr>
                ${alertRows}
              </table>
              <p style="color:#666;font-size:12px;margin-top:16px">Sent by PSB Properties Maintenance Hub</p>
            `,
          });
          console.log(`[Utilities] Overusage alert email sent for ${alerts.length} properties`);
        } catch (e2) {
          console.error('[Utilities] Failed to send overusage alert email:', e2.message);
        }
      }
    }

    res.json({ success: true, alerts_created: alerts.length, alerts });
  } finally { db.close(); }
});

// ===== METER REFERENCES =====
router.get('/meter-refs', authenticate, (req, res) => {
  const db = getDb();
  try {
    // Get distinct meter references from readings, grouped by property
    const refs = db.prepare(`
      SELECT DISTINCT mr.property_id, mr.property_name,
        mr.meter_type, mr.mprn, mr.mpan, mr.water_ref,
        p.name as parent_property_name
      FROM meter_readings mr
      LEFT JOIN properties p ON mr.property_id = p.id
      WHERE mr.mprn IS NOT NULL OR mr.mpan IS NOT NULL OR mr.water_ref IS NOT NULL
      ORDER BY p.name, mr.property_name, mr.meter_type
    `).all();
    res.json(refs);
  } finally { db.close(); }
});

module.exports = router;
