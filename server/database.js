const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Support DATABASE_PATH env var for Railway Volumes (e.g. /data/maintenance.db)
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'maintenance.db');

// Singleton database connection - stays open for the lifetime of the process
let _db = null;

function getRawDb() {
  if (!_db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');     // Write-Ahead Logging for better concurrent reads
    _db.pragma('busy_timeout = 5000');    // Wait up to 5s if DB is locked
    _db.pragma('foreign_keys = ON');
    console.log(`  [DB] Connected to ${DB_PATH}`);
  }
  return _db;
}

/**
 * Returns a DB wrapper with the same API the rest of the app expects.
 * Uses a singleton connection under the hood - close() is a safe no-op.
 */
function getDb() {
  const db = getRawDb();
  return {
    exec(sql) { db.exec(sql); },
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run(...params) { return stmt.run(...params); },
        get(...params) { return stmt.get(...params); },
        all(...params) { return stmt.all(...params); },
      };
    },
    pragma(str) { if (str) db.pragma(str); },
    close() { /* no-op: singleton stays open */ },
  };
}

async function initialiseDatabase() {
  const db = getDb();

  db.exec(`CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT NOT NULL,
    postcode TEXT, num_units INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL,
    email TEXT, property_id INTEGER, flat_number TEXT, whatsapp_id TEXT,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL, tenant_id INTEGER NOT NULL,
    property_id INTEGER, flat_number TEXT, category TEXT, title TEXT NOT NULL, description TEXT,
    status TEXT DEFAULT 'open', priority TEXT DEFAULT 'medium', ai_diagnosis TEXT,
    ai_suggested_fixes TEXT,
    estimated_cost REAL DEFAULT 0, estimated_materials TEXT, estimated_hours REAL DEFAULT 0,
    final_cost REAL, final_notes TEXT, attended_by TEXT, resolution_notes TEXT,
    escalated_at DATETIME, resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id), FOREIGN KEY (property_id) REFERENCES properties(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, sender TEXT NOT NULL,
    content TEXT, message_type TEXT DEFAULT 'text', media_url TEXT, whatsapp_message_id TEXT,
    metadata TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, message_id INTEGER,
    file_path TEXT NOT NULL, file_type TEXT, original_name TEXT, ai_analysis TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id), FOREIGN KEY (message_id) REFERENCES messages(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, role TEXT DEFAULT 'maintenance', active INTEGER DEFAULT 1,
    last_login DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, action TEXT NOT NULL,
    details TEXT, performed_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
  )`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_issues_tenant ON issues(tenant_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_issues_property ON issues(property_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_issue ON messages(issue_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenants_phone ON tenants(phone)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON messages(whatsapp_message_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS internal_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL,
    content TEXT NOT NULL, author TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS contractors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, trade TEXT NOT NULL,
    phone TEXT, email TEXT, notes TEXT, active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL,
    contractor_id INTEGER NOT NULL, description TEXT, amount REAL,
    status TEXT DEFAULT 'requested', notes TEXT,
    quoted_at DATETIME, approved_at DATETIME, completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id),
    FOREIGN KEY (contractor_id) REFERENCES contractors(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS property_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL,
    year INTEGER NOT NULL, annual_budget REAL NOT NULL DEFAULT 0, notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id),
    UNIQUE(property_id, year)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS tenancies (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL,
    property_id INTEGER NOT NULL, flat_number TEXT,
    academic_year TEXT NOT NULL, tenancy_start DATE, tenancy_end DATE,
    rent_weekly REAL, rent_monthly REAL, active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (property_id) REFERENCES properties(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS email_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL,
    email_address TEXT NOT NULL, credentials TEXT,
    last_sync_at DATETIME, sync_enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS email_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email_account_id INTEGER NOT NULL,
    message_id TEXT NOT NULL UNIQUE, from_address TEXT, subject TEXT,
    matched_tenant_id INTEGER, issue_id INTEGER,
    status TEXT DEFAULT 'processed',
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (email_account_id) REFERENCES email_accounts(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS compliance_certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL,
    cert_type TEXT NOT NULL, certificate_number TEXT,
    issued_date DATE, expiry_date DATE,
    status TEXT DEFAULT 'valid', provider TEXT, notes TEXT,
    document_id INTEGER, reminder_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER, tenant_id INTEGER,
    category TEXT NOT NULL, name TEXT NOT NULL,
    file_path TEXT NOT NULL, file_type TEXT, file_size INTEGER,
    uploaded_by TEXT, notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  )`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_tenancies_tenant ON tenancies(tenant_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenancies_property ON tenancies(property_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenancies_year ON tenancies(academic_year)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_compliance_property ON compliance_certificates(property_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_compliance_expiry ON compliance_certificates(expiry_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_property ON documents(property_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_email_sync_msg ON email_sync_log(message_id)');

  // ===== UTILITIES MANAGEMENT TABLES =====
  db.exec(`CREATE TABLE IF NOT EXISTS meter_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    property_name TEXT,
    meter_type TEXT NOT NULL,
    mprn TEXT,
    mpan TEXT,
    water_ref TEXT,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    reading REAL,
    usage_kwh REAL DEFAULT 0,
    cost REAL DEFAULT 0,
    change_vs_prev REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id),
    UNIQUE(property_id, meter_type, month, year, property_name)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS utility_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_type TEXT NOT NULL,
    rate_value REAL NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    property_id INTEGER,
    property_name TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS utility_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    meter_type TEXT NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    usage_kwh REAL,
    avg_usage REAL,
    threshold_pct REAL DEFAULT 120,
    alert_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fair_usage_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    meter_type TEXT NOT NULL,
    monthly_limit_kwh REAL,
    academic_year TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id),
    UNIQUE(property_id, meter_type, academic_year)
  )`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_meter_readings_property ON meter_readings(property_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_meter_readings_period ON meter_readings(year, month)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_utility_alerts_property ON utility_alerts(property_id)');

  // Migrate meter_readings unique constraint if table already exists without property_name in unique
  // (safe to run - just adds the column to the unique constraint concept via the CREATE TABLE IF NOT EXISTS above)

  // Migrate existing DBs (safe to run multiple times)
  const cols = [
    ['issues','estimated_cost','ALTER TABLE issues ADD COLUMN estimated_cost REAL DEFAULT 0'],
    ['issues','estimated_materials','ALTER TABLE issues ADD COLUMN estimated_materials TEXT'],
    ['issues','estimated_hours','ALTER TABLE issues ADD COLUMN estimated_hours REAL DEFAULT 0'],
    ['issues','final_cost','ALTER TABLE issues ADD COLUMN final_cost REAL'],
    ['issues','final_notes','ALTER TABLE issues ADD COLUMN final_notes TEXT'],
    ['issues','attended_by','ALTER TABLE issues ADD COLUMN attended_by TEXT'],
    ['issues','resolution_notes','ALTER TABLE issues ADD COLUMN resolution_notes TEXT'],
    ['staff','phone','ALTER TABLE staff ADD COLUMN phone TEXT'],
    ['tenants','student_id','ALTER TABLE tenants ADD COLUMN student_id TEXT'],
    ['tenants','academic_year','ALTER TABLE tenants ADD COLUMN academic_year TEXT'],
    ['tenants','tenancy_start','ALTER TABLE tenants ADD COLUMN tenancy_start DATE'],
    ['tenants','tenancy_end','ALTER TABLE tenants ADD COLUMN tenancy_end DATE'],
    ['tenants','active','ALTER TABLE tenants ADD COLUMN active INTEGER DEFAULT 1'],
    ['issues','ai_report','ALTER TABLE issues ADD COLUMN ai_report TEXT'],
    ['issues','ai_report_generated_at','ALTER TABLE issues ADD COLUMN ai_report_generated_at DATETIME'],
    ['utility_rates','property_id','ALTER TABLE utility_rates ADD COLUMN property_id INTEGER'],
    ['utility_rates','property_name','ALTER TABLE utility_rates ADD COLUMN property_name TEXT'],
  ];
  for (const [t,c,s] of cols) {
    try { db.prepare(`SELECT ${c} FROM ${t} LIMIT 0`).all(); } catch(e) {
      try { db.exec(s); console.log(`  Migrated: ${c}`); } catch(e2) {}
    }
  }

  // Seed admin
  if (!db.prepare('SELECT id FROM staff WHERE email = ?').get(process.env.ADMIN_EMAIL || 'admin@52oldelvet.com')) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'changeme123', 10);
    db.prepare('INSERT INTO staff (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run('Admin', process.env.ADMIN_EMAIL || 'admin@52oldelvet.com', hash, 'admin');
    console.log('  Admin created');
  }

  // Seed team
  for (const [name, email] of [['Hannah Winn','hannah@52oldelvet.com'],['Andy Turns','andy@52oldelvet.com'],['Akiel Mahmood','akiel@52oldelvet.com']]) {
    if (!db.prepare('SELECT id FROM staff WHERE email = ?').get(email)) {
      db.prepare('INSERT INTO staff (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, bcrypt.hashSync('psb2026!', 10), 'maintenance');
      console.log(`  Team member created: ${name}`);
    }
  }

  // Seed settings
  for (const [k,v] of [
    ['llm_provider', process.env.LLM_PROVIDER || 'openai'],
    ['anthropic_api_key', process.env.ANTHROPIC_API_KEY || ''],
    ['openai_api_key', process.env.OPENAI_API_KEY || ''],
    ['escalation_threshold', '3'],
    ['escalation_email', process.env.ESCALATION_EMAIL || 'admin@52oldelvet.com'],
    ['bot_greeting', "Hey! I'm the PSB Properties maintenance bot."],
    ['bot_escalation_message', "Escalated to our team. Ref: {ref}. They'll be in touch shortly."],
    ['auto_status_updates', 'true'],
    ['staff_notify_phones', ''],
  ]) { db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v); }
  if (process.env.LLM_PROVIDER) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(process.env.LLM_PROVIDER, 'llm_provider');
  if (process.env.OPENAI_API_KEY) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(process.env.OPENAI_API_KEY, 'openai_api_key');
  if (process.env.ANTHROPIC_API_KEY) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(process.env.ANTHROPIC_API_KEY, 'anthropic_api_key');

  // Seed properties
  if (!db.prepare("SELECT id FROM properties WHERE name = '33 Old Elvet'").get()) {
    db.exec('DELETE FROM properties');
    for (const [n,a,p,u] of [
      ['52 Old Elvet','52 Old Elvet, Durham','DH1 3HN',12],['33 Old Elvet','33 Old Elvet, Durham','DH1 3HN',1],
      ['Flass Court 2A','Flass Court 2A, Durham','DH1 3HN',1],['Flass Court 2B','Flass Court 2B, Durham','DH1 3HN',1],
      ['Flass Court Lower','Flass Court Lower, Durham','DH1 3HN',1],['Flass House Upper','Flass House Upper, Durham','DH1 3HN',1],
      ['Flass House Lower','Flass House Lower, Durham','DH1 3HN',1],['Claypath Flat 1','Claypath Flat 1, Durham','DH1 1QT',1],
      ['Claypath Flat 2','Claypath Flat 2, Durham','DH1 1QT',1],['Claypath Flat 3','Claypath Flat 3, Durham','DH1 1QT',1],
      ['Claypath Flat 4','Claypath Flat 4, Durham','DH1 1QT',1],['35 St Andrews Court','35 St Andrews Court, Durham','DH1',1],
      ['7 Cathedrals','7 Cathedrals, Durham','DH1',1],['2 St Margarets Mews','2 St Margarets Mews, Durham','DH1',1],
      ['24 Hallgarth Street','24 Hallgarth Street, Durham','DH1 3AT',1],
    ]) { db.prepare('INSERT INTO properties (name, address, postcode, num_units) VALUES (?, ?, ?, ?)').run(n,a,p,u); }
    console.log('  Properties seeded');
  }
  // Remove Markhim (not a real property) - migrate any linked records to 35 St Andrews Court
  const markhim = db.prepare("SELECT id FROM properties WHERE name = 'Markhim'").get();
  if (markhim) {
    const stAndrews = db.prepare("SELECT id FROM properties WHERE name = '35 St Andrews Court'").get();
    const targetId = stAndrews?.id || null;
    if (targetId) {
      db.prepare('UPDATE tenants SET property_id = ? WHERE property_id = ?').run(targetId, markhim.id);
      db.prepare('UPDATE tenancies SET property_id = ? WHERE property_id = ?').run(targetId, markhim.id);
      db.prepare('UPDATE issues SET property_id = ? WHERE property_id = ?').run(targetId, markhim.id);
    }
    try { db.prepare('DELETE FROM compliance_certificates WHERE property_id = ?').run(markhim.id); } catch(e) {}
    try { db.prepare('DELETE FROM documents WHERE property_id = ?').run(markhim.id); } catch(e) {}
    try { db.prepare('DELETE FROM property_budgets WHERE property_id = ?').run(markhim.id); } catch(e) {}
    db.prepare('DELETE FROM properties WHERE id = ?').run(markhim.id);
    console.log('  Removed Markhim property (migrated records to 35 St Andrews Court)');
  }

  // Seed contractors
  if (!db.prepare("SELECT id FROM contractors WHERE name = 'Tony the Plumber'").get()) {
    for (const [name, trade, notes] of [
      ['Tony the Plumber', 'plumbing', 'Regular plumber'],
      ['Neville the Joiner', 'joinery', 'Regular joiner'],
      ['Paul Holmes', 'electrical', 'Electrician'],
      ['Roofing Masters', 'roofing', 'Roofing contractor'],
    ]) { db.prepare('INSERT INTO contractors (name, trade, notes) VALUES (?, ?, ?)').run(name, trade, notes); }
    console.log('  Contractors seeded');
  }

  // --- One-time reseed: clear old tenants, keep only current year ---
  const tenantReseedFlag = db.prepare("SELECT value FROM settings WHERE key = 'tenant_reseed_v3'").get();
  if (!tenantReseedFlag) {
    db.exec('DELETE FROM tenancies');
    db.exec('DELETE FROM tenants');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tenant_reseed_v3', '1')").run();
    console.log('  Cleared tenants for current-year-only reseed');
  }

  // --- Seed tenants from spreadsheet data ---
  seedTenants(db);

  // --- One-time reseed: clear old meter readings so seedMeterReadings() re-runs with FFR data ---
  const reseedFlag = db.prepare("SELECT value FROM settings WHERE key = 'meter_reseed_v2'").get();
  if (!reseedFlag) {
    db.exec('DELETE FROM meter_readings');
    db.exec('DELETE FROM utility_alerts');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('meter_reseed_v2', '1')").run();
    console.log('  Cleared meter readings for FFR Group reseed');
  }

  // --- Remove Church Hill properties (not ours) ---
  for (const chName of ['Flat 1 Church Hill','Flat 2 Church Hill','Flat 3 Church Hill','Flat 4 Church Hill']) {
    const chProp = db.prepare('SELECT id FROM properties WHERE name = ?').get(chName);
    if (chProp) {
      db.prepare('DELETE FROM meter_readings WHERE property_id = ?').run(chProp.id);
      try { db.prepare('DELETE FROM utility_alerts WHERE property_id = ?').run(chProp.id); } catch(e) {}
      try { db.prepare('DELETE FROM fair_usage_limits WHERE property_id = ?').run(chProp.id); } catch(e) {}
      try { db.prepare('DELETE FROM compliance_certificates WHERE property_id = ?').run(chProp.id); } catch(e) {}
      try { db.prepare('DELETE FROM documents WHERE property_id = ?').run(chProp.id); } catch(e) {}
      try { db.prepare('DELETE FROM property_budgets WHERE property_id = ?').run(chProp.id); } catch(e) {}
      db.prepare('DELETE FROM properties WHERE id = ?').run(chProp.id);
      console.log(`  Removed Church Hill property: ${chName}`);
    }
  }

  // --- Seed meter readings from spreadsheet data ---
  seedMeterReadings(db);

  console.log('  Database initialised successfully');
}

/** Normalize phone to WhatsApp format: strip spaces/+, convert 07→447 */
function normalizePhone(raw) {
  if (!raw) return '';
  let p = String(raw).replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('07')) p = '44' + p.slice(1);
  if (p.startsWith('007')) p = '44' + p.slice(2);
  return p;
}

/** Map spreadsheet property names → DB property names */
const PROP_MAP = {
  '33 Old Elvet': '33 Old Elvet',
  '2B, Flass Court': 'Flass Court 2B',
  '2A, Flass Court': 'Flass Court 2A',
  'Flass Court Lower': 'Flass Court Lower',
  'Flass House Upper': 'Flass House Upper',
  'Flass House Lower': 'Flass House Lower',
  'Claypath Flat 1': 'Claypath Flat 1',
  'Claypath Flat 2': 'Claypath Flat 2',
  'Claypath Flat 3': 'Claypath Flat 3',
  'Claypath Flat 4': 'Claypath Flat 4',
  '35 St Andrews Court': '35 St Andrews Court',
  '7 Cathedrals': '7 Cathedrals',
  '24 Hallgarth Street': '24 Hallgarth Street',
  'Markhim': 'Markhim',
};

function seedTenants(db) {
  // Skip if already seeded
  if (db.prepare("SELECT id FROM tenants WHERE name = 'Edward Jack Trehearn'").get()) return;

  const propCache = {};
  function getPropId(name) {
    if (propCache[name]) return propCache[name];
    const dbName = PROP_MAP[name] || name;
    const row = db.prepare('SELECT id FROM properties WHERE name = ?').get(dbName);
    propCache[name] = row ? row.id : null;
    return propCache[name];
  }

  const insertTenant = db.prepare('INSERT OR IGNORE INTO tenants (name, phone, email, property_id, student_id, academic_year, tenancy_start, tenancy_end, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertTenancy = db.prepare('INSERT OR IGNORE INTO tenancies (tenant_id, property_id, flat_number, academic_year, tenancy_start, tenancy_end, rent_weekly, rent_monthly, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

  // PSB Tenants 2025-2026 (current year, tenancy Jul 2025 → Jun 2026)
  const t2526 = [
    ['33 Old Elvet','Edward Jack Trehearn','001070696','edtrehearn@outlook.com','07895 642537',195,845],
    ['33 Old Elvet','William Hugo Springett','001103659','will_springett@outlook.com','07903 804896',195,845],
    ['33 Old Elvet','Zachary Joel Theo Downes','001076343','zachjtdownes@gmail.com','07946 462126',195,845],
    ['33 Old Elvet','Devon Makepeace','001097238','devon@jawasoft.com','07862 617358',195,845],
    ['33 Old Elvet','James Oslo Adamson','001075187','oslosavage@gmail.com','07931 852616',195,845],
    ['33 Old Elvet','Jonathan Frost','001072859','jontyfrost58@icloud.com','07585 175317',195,845],
    ['33 Old Elvet','Ethan Noble','001038394','enoble531@outlook.com','07710 017226',195,845],
    ['2B, Flass Court','Sadie Noel','001155081','sadienoel29@gmail.com','07398 711288',171,741],
    ['2B, Flass Court','Ellie Hutty','001136682','elliemhutty@gmail.com','07388 315349',171,741],
    ['2B, Flass Court','Madeleine Baxter','001136934','maddiebxter101@gmail.com','07712 472527',171,741],
    ['2B, Flass Court','Jessica Hodgson-Mensah','001143217','jessmensah2@gmail.com','07504 239309',171,741],
    ['2A, Flass Court','Edward Duff','001141936','edwardjaduff@gmail.com','07484 154569',171,741],
    ['2A, Flass Court','Oliver Kaye','001140903','oliverakaye@yahoo.com','07584 346432',171,741],
    ['2A, Flass Court','Alexander Higginbottom','001192146','aahigg1@icloud.com','07523 796131',171,741],
    ['2A, Flass Court','James Ogilvie','001186154','jamesedwardogilvie@gmail.com','07399 621368',171,741],
    ['Flass Court Lower','Harry Gough','001178720','harrygough04@gmail.com','07593 564540',171,741],
    ['Flass Court Lower','Callum Kaleel Rowland','001186434','callumrowland@outlook.com','07392 325813',171,741],
    ['Flass Court Lower','Thomas Shepherd','001173806','TWS1506@icloud.com','07437 614958',171,741],
    ['Flass Court Lower','Ruairi Arthur Laing Gifford','001173324','ruairialgifford@gmail.com','07593 650236',171,741],
    ['Flass Court Lower','William Frederick laverack','001182516','laverack.will@gmail.com','07477 876404',171,741],
    ['Flass Court Lower','Aaron Uzomah Aguele','001171259','aaronaguele@gmail.com','07944 755707',171,741],
    ['Flass House Upper','Anaïs Dernis','001138379','tdlk37@durham.ac.uk','07941 688021',185,802],
    ['Flass House Upper','Francesca Rickett','001136551','hkbd85@durham.ac.uk','07498 540743',185,824],
    ['Flass House Upper','Sara Cassidy Plautz','001146110','kvkf76@durham.ac.uk','15408367560',185,802],
    ['Flass House Upper','Charles Davis','001099039','xqpj28@durham.ac.uk','07748 318815',185,824],
    ['Flass House Upper','James Bove','001077646','xccd35@durham.ac.uk','07480 946260',185,736],
    ['Flass House Upper','Joseph Oudkerk','001186889','nrhp33@durham.ac.uk','07525 084311',185,824],
    ['Flass House Upper','Timothy Griffin','001151185','wzkc67@durham.ac.uk','07956 835810',185,824],
    ['Flass House Upper','Florence Bray','001180483','tfgk78@durham.ac.uk','07954 635907',185,802],
    ['Flass House Upper','Emily Laura Thornton','001143881','emilythornton78@gmail.com','07711 806163',185,802],
    ['Flass House Lower','Srishti Rakhecha','001109094','srishti.rakhecha@gmail.com','07774 876006',179,776],
    ['Flass House Lower','Mallika Shah','001095816','mallika05shah@gmail.com','07767 928014',179,776],
    ['Flass House Lower','Nithya Viswanathan','001113268','nithya.v1803@gmail.com','07918 580004',179,776],
    ['Flass House Lower','Simran Jalan','001093621','simranrjalan@gmail.com','07767 451285',179,776],
    ['Flass House Lower','Alexandra Joy Mawby','001168484','alexandra.mawby@hotmail.com','07925 285884',179,776],
    ['Flass House Lower','Joan Nyemb','001042225','joannyemb@gmail.com','07402 087154',179,776],
    ['Claypath Flat 1','Alexandra Rachel Bryan','001139457','lexi.bryan1@outlook.com','07401 571834',182,789],
    ['Claypath Flat 1','William James Horrell','001137117','willhorrell2@icloud.com','07392 807480',182,789],
    ['Claypath Flat 1','Emily Elizabeth Ames','001136544','amesee04@gmail.com','07518 064391',182,789],
    ['Claypath Flat 1','Edward Bradnam','001157556','ebradnam@icloud.com','07460 991328',182,789],
    ['Claypath Flat 1','Kate Lelliott Clements','001177925','katelelliottt@gmail.com','07722 953180',182,789],
    ['Claypath Flat 1','Thomas Stuart Higgins','001136599','higginsthomas1612@gmail.com','07488 312965',182,789],
    ['Claypath Flat 2','Oliver Francis Liddiard','001151097','oliverliddiard@outlook.com','07548 641484',182,789],
    ['Claypath Flat 2','Taormina Pippinita Kaur Plummer','001163843','pipplummer@icloud.com','07729 446295',182,789],
    ['Claypath Flat 2','Eloise Sophie Greig','001135540','greigeloise@gmail.com','07587 895316',182,789],
    ['Claypath Flat 2','Edward Milo Childs','001160202','teddychilds67@gmail.com','07913 725992',182,789],
    ['Claypath Flat 2','Felix Cay Henning Graf Brockdorff Ahlefeldt','001162540','felix.brockdorff@gmail.com','07488 378004',182,789],
    ['Claypath Flat 3','William Porter','001079078','wbenedictp@gmail.com','07500 504932',182,789],
    ['Claypath Flat 3','Lucia McDonald','001135792','19lulumcdonald@gmail.com','07546 433780',182,789],
    ['Claypath Flat 3','Matthew Collotta','001140488','matthewcollotta@gmail.com','07706 626733',182,789],
    ['Claypath Flat 3','Kylie Strand','001159064','kystrand05@gmail.com','19527377016',182,789],
    ['Claypath Flat 3','Federica Maria Brillembourg Wallis','001167513','bww.federica@gmail.com','07341 909715',182,789],
    ['Claypath Flat 3','Zoe Chapman','001201911','zoechapman012@gmail.com','07721 963777',182,789],
    ['Claypath Flat 4','Samuel Earnshaw','001091954','samuelearnshaw@icloud.com','07889 712351',182,789],
    ['Claypath Flat 4','Kofi Okyere','001071272','kofi.s.okyere@gmail.com','07481 237167',182,789],
    ['Claypath Flat 4','Roni Cakmak','001107567','ronicakmak12@gmail.com','07504 531137',182,789],
    ['Claypath Flat 4','Lucas Fisher','001087866','lucasmacleanfisher@gmail.com','07484 874503',182,789],
    ['Claypath Flat 4','Luke Palmer','001102965','lukewenjie@icloud.com','07570 088423',182,789],
    ['Claypath Flat 4','Henry Richardson','001108018','henry.richardson.farm@gmail.com','07432 691330',182,789],
    ['35 St Andrews Court','Mingtong Wei','001155845','m18610465852@163.com','07901 198460',260,1127],
    ['Markhim','Yuxin Yan','001164673','13290695118@163.com','07303 091864',260,1127],
    ['7 Cathedrals','Nuo Xu','001164678','xun377375@gmail.com','07776 269327',420,1820],
    ['24 Hallgarth Street','Ashley Wright','','wrightsclan2@gmail.com','07759 077416',508,2200],
    ['24 Hallgarth Street','Karan Wright','','wrightsclan@icloud.com','07522 859026',508,2200],
  ];

  // 52 Old Elvet apartment tenants 2026-2027
  const t52oe = [
    ['The Villiers','Hamza Chattha','001133797','h.chattha06@gmail.com','07391 378936'],
    ['The Villiers','Muhammed Haadi Malik','001164665','haadz1009@gmail.com','07402 021399'],
    ['The Egerton','Agharese Akpata','001134280','ari.akpata@gmail.com','07496 797407'],
    ['The Wolsey','Yang Lin','001164694','2993667141@qq.com','07467 164937'],
    ['The Wolsey','Runpeng Tian','001155855','3362237995@qq.com','07780 714083'],
    ['The Tunstall','Lucy Witkowski','001139008','lucywitkowski@hotmail.co.uk','07462 340410'],
    ['The Montague','Harry Lai','001133853','photoshooted123@gmail.com','07988 330545'],
    ['The Montague','Abdulhakeem Qambar','001133518','abdulhakeem.qamber@gmail.com','07438593975'],
    ['The Morton','Dario Cozzolino','001164922','dariocozzolino222@gmail.com','07342 207075'],
    ['The Gray','Sherina Ng','001071807','sherinang77@gmail.com','07769 069702'],
    ['The Langley','Katla Larusdottir','001185581','katlabjork7@gmail.com','07946 818706'],
    ['The Langley','Morolaowula Oduntan','001134589','morolaoduntan@icloud.com','07377 870332'],
    ['The Kirkham','Maya Kayaoğlu','001182093','kayaoglu.maya@gmail.com','07471 579030'],
    ['The Kirkham','Ada Cebbar','001176650','adacebbar@gmail.com','07774 007028'],
    ['The Fordham','Shivam Bhardwaj','001170630','shivam120302@gmail.com','07733 849110'],
    ['The Fordham','Karim Esmat Al Qudah','001157730','kareemalqudah2006@gmail.com','07570 826028'],
    ['The Talbot Penthouse','Chao Huang','001232473','3159963508@qq.com','07731 595236'],
    ['The Talbot Penthouse','Chenxi Xu','001232487','xuchenxi0923@163.com','07535 281841'],
  ];

  // Helper to seed a batch of tenants
  function seedBatch(data, academicYear, startDate, endDate, is52OE) {
    let count = 0;
    for (const row of data) {
      const [prop, name, studentId, email, phone, rentW, rentM] = is52OE
        ? [row[0], row[1], row[2], row[3], row[4], 0, 0]
        : row;

      const normPhone = normalizePhone(phone);
      if (!normPhone && !email) continue; // skip entries with no contact info

      const propId = is52OE
        ? db.prepare("SELECT id FROM properties WHERE name = '52 Old Elvet'").get()?.id
        : getPropId(prop);

      if (!propId) { console.log(`  [Seed] Property not found: ${prop}`); continue; }

      // Insert tenant (or skip if phone already exists)
      const phoneVal = normPhone || `no-phone-${name.replace(/\s/g,'-').toLowerCase()}`;
      const result = insertTenant.run(name, phoneVal, email || null, propId, studentId || null, academicYear, startDate, endDate, 1);

      // Get tenant id (either just inserted or existing)
      let tenantId;
      if (result.changes > 0) {
        tenantId = result.lastInsertRowid;
        count++;
      } else {
        const existing = db.prepare('SELECT id FROM tenants WHERE phone = ?').get(phoneVal);
        tenantId = existing?.id;
      }

      if (!tenantId) continue;

      // Insert tenancy record
      const flatNum = is52OE ? prop : null;
      try {
        insertTenancy.run(tenantId, propId, flatNum, academicYear, startDate, endDate, rentW || null, rentM || null, 1);
      } catch (e) { /* duplicate tenancy, skip */ }
    }
    return count;
  }

  const c1 = seedBatch(t2526, '2025-2026', '2025-07-01', '2026-06-30', false);
  const c3 = seedBatch(t52oe, '2026-2027', '2025-09-01', '2027-06-30', true);
  if (c1 + c3 > 0) console.log(`  Tenants seeded: ${c1} (PSB 25-26) + ${c3} (52 OE 26-27)`);
}

function seedMeterReadings(db) {
  // Skip if already seeded
  if (db.prepare('SELECT id FROM meter_readings LIMIT 1').get()) return;

  // Get 52 Old Elvet property ID
  const oeRow = db.prepare("SELECT id FROM properties WHERE name = '52 Old Elvet'").get();
  if (!oeRow) { console.log('  [Seed] 52 Old Elvet not found, skipping meter readings'); return; }
  const oeId = oeRow.id;

  // Ensure FFR Group properties exist
  for (const [name, addr] of [
    ['41 Old Elvet', '41 Old Elvet, Durham'],
    ['2 St Margarets Mews', '2 St Margarets Mews, Durham'],
  ]) {
    if (!db.prepare('SELECT id FROM properties WHERE name = ?').get(name)) {
      db.prepare('INSERT INTO properties (name, address, postcode, num_units) VALUES (?, ?, ?, ?)').run(name, addr, 'DH1', 1);
    }
  }

  const ffrIds = {};
  for (const name of ['Flass House Upper','Flass Court 2B','Flass Court 2A','Flass Court Lower','33 Old Elvet','41 Old Elvet','35 St Andrews Court','7 Cathedrals','2 St Margarets Mews']) {
    ffrIds[name] = db.prepare('SELECT id FROM properties WHERE name = ?').get(name)?.id;
  }

  const insert = db.prepare(`INSERT OR IGNORE INTO meter_readings
    (property_id, property_name, meter_type, mprn, mpan, water_ref, month, year, reading, usage_kwh, cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // 52 OE apartment meter refs
  const oeRefs = {
    'Landlord Supply':       { mprn: null,           mpan: '15 8000 1565 600', water: null },
    'The Villiers':          { mprn: '9363633108',   mpan: '15 8000 1565 489', water: '18FA2888 27' },
    'The Barrington':        { mprn: '9363480906',   mpan: '15 8000 1565 521', water: '18FA2888 72' },
    'The Egerton':           { mprn: '9363485804',   mpan: '15 8000 1565 498', water: '18FA2888 75' },
    'The Wolsey':            { mprn: '1345210304',   mpan: '15 8000 1565 503', water: null },
    'The Tunstall':          { mprn: '9363479304',   mpan: '15 8000 1565 512', water: '18MA222496' },
    'The Montague':          { mprn: '9363756607',   mpan: '15 8000 1565 530', water: '18FA2888 76' },
    'The Morton':            { mprn: '9363659508',   mpan: '15 8000 1565 540', water: '18FA2888 79' },
    'The Gray':              { mprn: '9363915309',   mpan: '15 8000 1565 559', water: '18FA2888 71' },
    'The Langley':           { mprn: '9363596903',   mpan: '15 8000 1565 568', water: '18FA2888 80' },
    'The Kirkham':           { mprn: '9363613304',   mpan: '15 8000 1565 577', water: '18FA2888 74' },
    'The Fordham':           { mprn: '9363691605',   mpan: '15 8000 1565 586', water: '18FA2888 77' },
    'The Talbot Penthouse':  { mprn: '9363865601',   mpan: '15 8000 1565 595', water: '18FA2888 78' },
  };

  // Helper: insert reading for 52 OE apartment
  function oeReading(aptName, meterType, month, year, reading, usage, cost) {
    if (reading == null && usage == null && cost == null) return;
    const refs = oeRefs[aptName] || {};
    insert.run(oeId, aptName, meterType, refs.mprn || null, refs.mpan || null, refs.water || null,
      month, year, reading, usage || 0, cost || 0);
  }

  // FFR Group meter references
  const ffrRefs = {
    'Flass House Upper': { mprn: '486 969 04', mpan: '15 9102 7863 104' },
    'Flass Court 2B':    { mprn: null, mpan: '15 8000 0497 483' },
    'Flass Court 2A':    { mprn: null, mpan: '15 8000 0497 474' },
    'Flass Court Lower': { mprn: null, mpan: '15 8000 0497 465' },
    '33 Old Elvet':      { mprn: null, mpan: '15 9105 4866 150' },
    '41 Old Elvet':      { mprn: '1345 209 802', mpan: '15 9104 2184 581' },
    '35 St Andrews Court': { mprn: null, mpan: '15 8000 0125 132' },
    '7 Cathedrals':      { mprn: null, mpan: '15 8000 0566 393' },
    '2 St Margarets Mews': { mprn: '1', mpan: null },
  };

  // Helper: insert reading for FFR property
  function ffrReading(propName, propId, meterType, month, year, reading, usage, cost) {
    if (reading == null && usage == null && cost == null) return;
    const refs = ffrRefs[propName] || {};
    insert.run(propId, propName, meterType, refs.mprn || null, refs.mpan || null, null, month, year, reading, usage || 0, cost || 0);
  }

  // ===== 52 OE 2025 January =====
  oeReading('Landlord Supply', 'electric', 1, 2025, 11746, 402, 111.186);
  oeReading('The Villiers', 'gas', 1, 2025, 5083, 842, 349.75);
  oeReading('The Villiers', 'electric', 1, 2025, 14127, 1678, 402.114);
  oeReading('The Barrington', 'gas', 1, 2025, 4000, 274, 120.18);
  oeReading('The Barrington', 'electric', 1, 2025, 7517, 104, 43.242);
  oeReading('The Egerton', 'gas', 1, 2025, 8543, 108, 153.34);
  oeReading('The Egerton', 'electric', 1, 2025, 7690, 118, 46.434);
  oeReading('The Wolsey', 'gas', 1, 2025, 769, 4, 15.57);
  oeReading('The Wolsey', 'electric', 1, 2025, 11979, 73, 36.174);
  oeReading('The Tunstall', 'gas', 1, 2025, 1736, 46, 33.24);
  oeReading('The Tunstall', 'electric', 1, 2025, 8306, 68, 35.034);
  oeReading('The Montague', 'gas', 1, 2025, 2949, 123, 66.64);
  oeReading('The Montague', 'electric', 1, 2025, 10602, 120, 46.89);
  oeReading('The Morton', 'gas', 1, 2025, 4620, 75, 48.22);
  oeReading('The Morton', 'electric', 1, 2025, 8390, 79, 37.542);
  oeReading('The Gray', 'gas', 1, 2025, 2077, 237, 113.04);
  oeReading('The Gray', 'electric', 1, 2025, 8079, 214, 68.322);
  oeReading('The Langley', 'gas', 1, 2025, 3564, 256, 120.07);
  oeReading('The Langley', 'electric', 1, 2025, 7993, 138, 50.994);
  oeReading('The Kirkham', 'gas', 1, 2025, 2883, 158, 78.51);
  oeReading('The Kirkham', 'electric', 1, 2025, 7871, 102, 42.786);
  oeReading('The Fordham', 'gas', 1, 2025, 3426, 41, 32.85);
  oeReading('The Fordham', 'electric', 1, 2025, 7910, 164, 56.922);
  oeReading('The Talbot Penthouse', 'gas', 1, 2025, 2483, 80, 47.96);
  oeReading('The Talbot Penthouse', 'electric', 1, 2025, 9789, 99, 42.102);

  // ===== 52 OE 2025 February =====
  oeReading('The Villiers', 'gas', 2, 2025, 5769, 686, 285.79);
  oeReading('The Barrington', 'gas', 2, 2025, 4216, 216, 95.83);
  oeReading('The Egerton', 'gas', 2, 2025, 8708, 165, 165.77);
  oeReading('The Wolsey', 'gas', 2, 2025, 802, 33, 25.94);
  oeReading('The Tunstall', 'gas', 2, 2025, 1808, 72, 42.33);
  oeReading('The Montague', 'gas', 2, 2025, 3170, 221, 104.61);
  oeReading('The Morton', 'gas', 2, 2025, 4651, 31, 28.70);
  oeReading('The Gray', 'gas', 2, 2025, 2273, 196, 94.80);
  oeReading('The Langley', 'gas', 2, 2025, 3786, 222, 104.72);
  oeReading('The Kirkham', 'gas', 2, 2025, 3041, 158, 77.09);
  oeReading('The Fordham', 'gas', 2, 2025, 3496, 70, 43.00);
  oeReading('The Talbot Penthouse', 'gas', 2, 2025, 2799, 316, 141.83);

  // ===== 52 OE 2026 January =====
  oeReading('Landlord Supply', 'electric', 1, 2026, 16149, 685, 175.71);
  oeReading('The Villiers', 'gas', 1, 2026, 6885, 373, 160.19);
  oeReading('The Villiers', 'electric', 1, 2026, 19979, 542, 143.106);
  oeReading('The Barrington', 'gas', 1, 2026, 5513, 349, 150.49);
  oeReading('The Barrington', 'electric', 1, 2026, 9044, 196, 64.218);
  oeReading('The Egerton', 'gas', 1, 2026, 9583, 248, 209.93);
  oeReading('The Egerton', 'electric', 1, 2026, 9017, 196, 64.218);
  oeReading('The Wolsey', 'gas', 1, 2026, 1587, 254, 116.61);
  oeReading('The Wolsey', 'electric', 1, 2026, 13956, 506, 134.898);
  oeReading('The Tunstall', 'gas', 1, 2026, 2322, 164, 80.93);
  oeReading('The Tunstall', 'electric', 1, 2026, 9579, 235, 73.11);
  oeReading('The Montague', 'gas', 1, 2026, 4642, 680, 291.76);
  oeReading('The Montague', 'electric', 1, 2026, 12882, 532, 140.826);
  oeReading('The Morton', 'gas', 1, 2026, 5172, 277, 129.86);
  oeReading('The Morton', 'electric', 1, 2026, 9271, 138, 50.994);
  oeReading('The Gray', 'gas', 1, 2026, 3203, 264, 123.95);
  oeReading('The Gray', 'electric', 1, 2026, 9462, 127, 48.486);
  oeReading('The Langley', 'gas', 1, 2026, 4827, 338, 153.21);
  oeReading('The Langley', 'electric', 1, 2026, 9392, 195, 63.99);
  oeReading('The Kirkham', 'gas', 1, 2026, 3947, 294, 133.47);
  oeReading('The Kirkham', 'electric', 1, 2026, 8991, 221, 69.918);
  oeReading('The Fordham', 'gas', 1, 2026, 4238, 251, 117.72);
  oeReading('The Fordham', 'electric', 1, 2026, 9869, 174, 59.202);
  oeReading('The Talbot Penthouse', 'gas', 1, 2026, 4110, 311, 141.32);
  oeReading('The Talbot Penthouse', 'electric', 1, 2026, 11498, 261, 79.038);

  // ===== 52 OE 2026 February =====
  oeReading('The Villiers', 'gas', 2, 2026, 7032, 147, 67.94);
  oeReading('The Barrington', 'gas', 2, 2026, 5679, 166, 75.62);
  oeReading('The Egerton', 'gas', 2, 2026, 9776, 193, 177.08);
  oeReading('The Wolsey', 'gas', 2, 2026, 1746, 159, 76.86);
  oeReading('The Tunstall', 'gas', 2, 2026, 2417, 95, 51.63);
  oeReading('The Montague', 'gas', 2, 2026, 5076, 434, 190.70);
  oeReading('The Morton', 'gas', 2, 2026, 5295, 123, 65.88);
  oeReading('The Gray', 'gas', 2, 2026, 3352, 149, 75.80);
  oeReading('The Langley', 'gas', 2, 2026, 5033, 206, 98.25);
  oeReading('The Kirkham', 'gas', 2, 2026, 4100, 153, 75.07);
  oeReading('The Fordham', 'gas', 2, 2026, 4351, 113, 60.37);
  oeReading('The Talbot Penthouse', 'gas', 2, 2026, 4305, 195, 92.92);

  // ===== FFR Group 2025 =====
  // Flass House Upper
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 1, 2025, 27325, 755, 368.62);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 1, 2025, 55498, 503, 97.39);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 2, 2025, 28190, 865, 406.94);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 2, 2025, 56019, 521, 100.40);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 3, 2025, 28946, 756, 369.02);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 3, 2025, 56745, 726, 134.62);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 4, 2025, 30047, 1101, 506.41);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 4, 2025, 57470, 725, 134.45);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 5, 2025, 30600, 553, 286.98);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 5, 2025, 58126, 656, 122.93);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 9, 2025, 31318, 71, 90.12);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 10, 2025, 31580, 262, 169.36);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 10, 2025, 59950, 302, 63.84);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 11, 2025, 32379, 799, 384.36);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 11, 2025, 60767, 817, 149.81);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'gas', 12, 2025, 33206, 827, 397.72);
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 12, 2025, 61863, 1096, 196.39);
  // Flass Court 2B (Day+Night combined)
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 1, 2025, 30831, 589, 112.97);
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 2, 2025, 31696, 1149, 205.74);
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 3, 2025, 32568, 1136, 204.35);
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 4, 2025, 33368, 1004, 183.48);
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 5, 2025, 33687, 379, 78.05);
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 10, 2025, 34841, 141, 35.60);
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 11, 2025, 35567, 786, 151.12);
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 12, 2025, 36464, 1013, 189.24);
  // Flass Court 2A (Day+Night combined)
  ffrReading('Flass Court 2A', ffrIds['Flass Court 2A'], 'electric', 1, 2025, 6799, 687, 133.41);
  ffrReading('Flass Court 2A', ffrIds['Flass Court 2A'], 'electric', 2, 2025, 7605, 895, 169.23);
  ffrReading('Flass Court 2A', ffrIds['Flass Court 2A'], 'electric', 5, 2025, 9960, 706, 134.51);
  ffrReading('Flass Court 2A', ffrIds['Flass Court 2A'], 'electric', 10, 2025, 11694, 452, 89.12);
  ffrReading('Flass Court 2A', ffrIds['Flass Court 2A'], 'electric', 11, 2025, 12368, 873, 160.10);
  ffrReading('Flass Court 2A', ffrIds['Flass Court 2A'], 'electric', 12, 2025, 13478, 1509, 264.80);
  // Flass Court Lower (Day+Night combined)
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 1, 2025, 7363, 223, 45.61);
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 2, 2025, 8180, 1047, 189.96);
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 3, 2025, 8934, 1121, 196.80);
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 4, 2025, 9602, 957, 171.03);
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 5, 2025, 9912, 393, 79.47);
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 10, 2025, 12665, 1140, 204.73);
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 11, 2025, 14359, 2173, 380.39);
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 12, 2025, 16124, 2311, 402.01);
  // 33 Old Elvet (electric only - individual meter)
  ffrReading('33 Old Elvet', ffrIds['33 Old Elvet'], 'electric', 10, 2025, 175332, 893, 155.84);
  // 41 Old Elvet
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'gas', 1, 2025, 7637, 0, 27.02);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'electric', 1, 2025, 20770, 657, 123.10);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'gas', 2, 2025, 7647, 10, 31.06);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'electric', 2, 2025, 21480, 710, 131.95);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'gas', 3, 2025, 7668, 21, 35.50);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'electric', 3, 2025, 22234, 754, 139.29);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'gas', 4, 2025, 7743, 75, 57.33);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'electric', 4, 2025, 23084, 850, 155.32);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'electric', 5, 2025, 23678, 594, 112.58);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'electric', 7, 2025, 24160, 482, 93.89);
  // 35 St Andrews Court (Day+Night combined)
  ffrReading('35 St Andrews Court', ffrIds['35 St Andrews Court'], 'electric', 1, 2025, 41134, 65, 37.70);
  ffrReading('35 St Andrews Court', ffrIds['35 St Andrews Court'], 'electric', 2, 2025, 41362, 272, 72.25);
  ffrReading('35 St Andrews Court', ffrIds['35 St Andrews Court'], 'electric', 3, 2025, 41659, 347, 84.77);
  ffrReading('35 St Andrews Court', ffrIds['35 St Andrews Court'], 'electric', 4, 2025, 41756, 117, 46.38);
  ffrReading('35 St Andrews Court', ffrIds['35 St Andrews Court'], 'electric', 5, 2025, 41860, 113, 45.71);
  ffrReading('35 St Andrews Court', ffrIds['35 St Andrews Court'], 'electric', 8, 2025, 42139, 105, 44.37);
  // 7 Cathedrals
  ffrReading('7 Cathedrals', ffrIds['7 Cathedrals'], 'electric', 1, 2025, 13036, 526, 101.23);
  ffrReading('7 Cathedrals', ffrIds['7 Cathedrals'], 'electric', 2, 2025, 14043, 1007, 181.53);
  ffrReading('7 Cathedrals', ffrIds['7 Cathedrals'], 'electric', 3, 2025, 15086, 1043, 187.54);
  ffrReading('7 Cathedrals', ffrIds['7 Cathedrals'], 'electric', 4, 2025, 16429, 1343, 237.62);
  ffrReading('7 Cathedrals', ffrIds['7 Cathedrals'], 'electric', 5, 2025, 16750, 321, 67.01);
  ffrReading('7 Cathedrals', ffrIds['7 Cathedrals'], 'electric', 11, 2025, 18002, 890, 162.00);
  ffrReading('7 Cathedrals', ffrIds['7 Cathedrals'], 'electric', 12, 2025, 18905, 903, 164.17);
  // 2 St Margarets Mews
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'gas', 1, 2025, 5361, 91, 148.74);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'electric', 1, 2025, 10994, 93, 42.88);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'gas', 2, 2025, 5417, 56, 99.31);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'electric', 2, 2025, 11067, 73, 36.31);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'gas', 3, 2025, 5566, 149, 123.69);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'electric', 3, 2025, 11164, 97, 43.77);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'gas', 4, 2025, 5630, 64, 111.76);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'electric', 4, 2025, 11262, 98, 43.27);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'gas', 5, 2025, 5665, 35, 73.83);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'electric', 5, 2025, 11351, 89, 42.00);

  // ===== FFR Group 2026 =====
  ffrReading('Flass House Upper', ffrIds['Flass House Upper'], 'electric', 1, 2026, 62034, 171, 41.97);
  ffrReading('Flass Court 2B', ffrIds['Flass Court 2B'], 'electric', 1, 2026, 36859, 460, 92.35);
  ffrReading('Flass Court 2A', ffrIds['Flass Court 2A'], 'electric', 1, 2026, 14052, 773, 142.15);
  ffrReading('Flass Court Lower', ffrIds['Flass Court Lower'], 'electric', 1, 2026, 18132, 2814, 480.07);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'gas', 1, 2026, 8004, 193, 105.02);
  ffrReading('41 Old Elvet', ffrIds['41 Old Elvet'], 'electric', 1, 2026, 25828, 595, 112.75);
  ffrReading('7 Cathedrals', ffrIds['7 Cathedrals'], 'electric', 1, 2026, 19264, 359, 73.35);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'gas', 2, 2026, 269, 269, 384.23);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'gas', 3, 2026, 498, 229, 156.03);
  ffrReading('2 St Margarets Mews', ffrIds['2 St Margarets Mews'], 'electric', 3, 2026, 12270, 178, 61.65);

  // Seed default utility rates
  const insertRate = db.prepare('INSERT OR IGNORE INTO utility_rates (rate_type, rate_value, effective_from, notes) VALUES (?, ?, ?, ?)');
  insertRate.run('gas_unit', 0.0415, '2024-01-01', 'Gas unit rate 4.15p/kWh');
  insertRate.run('electric_unit', 0.245, '2024-01-01', 'Electric unit rate 24.50p/kWh');
  insertRate.run('gas_standing', 0.2735, '2024-01-01', 'Gas standing charge 27.35p/day');
  insertRate.run('electric_standing', 0.5335, '2024-01-01', 'Electric standing charge 53.35p/day');
  insertRate.run('vat_rate', 0.05, '2024-01-01', 'VAT rate 5%');

  console.log('  Meter readings and utility rates seeded');
}

// Graceful shutdown - close DB properly on process exit
process.on('SIGTERM', () => { if (_db) { _db.close(); _db = null; } });
process.on('SIGINT', () => { if (_db) { _db.close(); _db = null; } process.exit(0); });

module.exports = { getDb, initialiseDatabase, DB_PATH };
