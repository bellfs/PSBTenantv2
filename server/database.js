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

  console.log('  Database initialised successfully');
}

// Graceful shutdown - close DB properly on process exit
process.on('SIGTERM', () => { if (_db) { _db.close(); _db = null; } });
process.on('SIGINT', () => { if (_db) { _db.close(); _db = null; } process.exit(0); });

module.exports = { getDb, initialiseDatabase, DB_PATH };
