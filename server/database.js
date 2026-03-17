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

  db.exec('CREATE INDEX IF NOT EXISTS idx_tenancies_tenant ON tenancies(tenant_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenancies_property ON tenancies(property_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenancies_year ON tenancies(academic_year)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_email_sync_msg ON email_sync_log(message_id)');

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

  // --- Seed tenants from spreadsheet data ---
  seedTenants(db);

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

  // 2025-2026 tenants (64 tenants, tenancy Jul 2025 → Jun 2026)
  const t2526 = [
    ['33 Old Elvet','Edward Jack Trehearn','001070696','edtrehearn@outlook.com','07895 642537',195,845],
    ['33 Old Elvet','William Hugo Springett','001103659','will_springett@outlook.com','07903 804896',195,845],
    ['33 Old Elvet','Zachary Joel Theo Downes','001081125','zachjtdownes@gmail.com','07946 462126',195,845],
    ['33 Old Elvet','Devon Makepeace','','devon@jawasoft.com','07862 617358',195,845],
    ['33 Old Elvet','James Oslo Adamson','001096753','oslosavage@gmail.com','07931 852616',195,845],
    ['33 Old Elvet','Jonathan Frost','001096700','jontyfrost58@icloud.com','07585 175317',195,845],
    ['33 Old Elvet','Ethan Noble','001082411','enoble531@outlook.com','07710 017226',195,845],
    ['2B, Flass Court','Sadie Noel','001094299','sadienoel29@gmail.com','07398 711288',195,845],
    ['2B, Flass Court','Ellie Hutty','001084519','elliemhutty@gmail.com','07388 315349',195,845],
    ['2B, Flass Court','Madeleine Baxter','001093781','maddiebxter101@gmail.com','07712 472527',195,845],
    ['2B, Flass Court','Jessica Hodgson-Mensah','001090458','jessmensah2@gmail.com','07504 239309',195,845],
    ['2A, Flass Court','Edward Duff','001085003','edwardjaduff@gmail.com','07484 154569',195,845],
    ['2A, Flass Court','Oliver Kaye','001094249','oliverakaye@yahoo.com','07584 346432',195,845],
    ['2A, Flass Court','Alexander Higginbottom','001097022','aahigg1@icloud.com','07523 796131',195,845],
    ['2A, Flass Court','James Ogilvie','001092478','jamesedwardogilvie@gmail.com','07399 621368',195,845],
    ['Flass Court Lower','Harry Gough','001089363','harrygough04@gmail.com','07593 564540',190,823],
    ['Flass Court Lower','Callum Kaleel Rowland','001098025','callumrowland@outlook.com','07392 325813',190,823],
    ['Flass Court Lower','Thomas Shepherd','001089534','TWS1506@icloud.com','07437 614958',190,823],
    ['Flass Court Lower','Ruairi Arthur Laing Gifford','001091556','ruairialgifford@gmail.com','07593 650236',190,823],
    ['Flass Court Lower','William Frederick laverack','001083484','laverack.will@gmail.com','07477 876404',190,823],
    ['Flass Court Lower','Aaron Uzomah Aguele','001094783','aaronaguele@gmail.com','07944 755707',190,823],
    ['Flass House Upper','Anaïs Dernis','','tdlk37@durham.ac.uk','07941 688021',150,650],
    ['Flass House Upper','Francesca Rickett','','hkbd85@durham.ac.uk','07498 540743',150,650],
    ['Flass House Upper','Sara Cassidy Plautz','','kvkf76@durham.ac.uk','15408367560',150,650],
    ['Flass House Upper','Charles Davis','','xqpj28@durham.ac.uk','07748 318815',150,650],
    ['Flass House Upper','James Bove','','xccd35@durham.ac.uk','07480 946260',150,650],
    ['Flass House Upper','Joseph Oudkerk','','nrhp33@durham.ac.uk','07525 084311',150,650],
    ['Flass House Upper','Timothy Griffin','','wzkc67@durham.ac.uk','07956 835810',150,650],
    ['Flass House Upper','Florence Bray','','tfgk78@durham.ac.uk','07954 635907',150,650],
    ['Flass House Upper','Emily Laura Thornton','','emilythornton78@gmail.com','07711 806163',150,650],
    ['Flass House Lower','Srishti Rakhecha','','srishti.rakhecha@gmail.com','07774 876006',150,650],
    ['Flass House Lower','Mallika Shah','','mallika05shah@gmail.com','07767 928014',150,650],
    ['Flass House Lower','Nithya Viswanathan','','nithya.v1803@gmail.com','07918 580004',150,650],
    ['Flass House Lower','Simran Jalan','','simranrjalan@gmail.com','07767 451285',150,650],
    ['Flass House Lower','Alexandra Joy Mawby','','alexandra.mawby@hotmail.com','07925 285884',150,650],
    ['Flass House Lower','Joan Nyemb','','joannyemb@gmail.com','07402 087154',150,650],
    ['Claypath Flat 1','Alexandra Rachel Bryan','','lexi.bryan1@outlook.com','07401 571834',165,715],
    ['Claypath Flat 1','William James Horrell','','willhorrell2@icloud.com','07392 807480',165,715],
    ['Claypath Flat 1','Emily Elizabeth Ames','','amesee04@gmail.com','07518 064391',165,715],
    ['Claypath Flat 1','Edward Bradnam','','ebradnam@icloud.com','07460 991328',165,715],
    ['Claypath Flat 1','Kate Lelliott Clements','','katelelliottt@gmail.com','07722 953180',165,715],
    ['Claypath Flat 1','Thomas Stuart Higgins','','higginsthomas1612@gmail.com','07488 312965',165,715],
    ['Claypath Flat 2','Oliver Francis Liddiard','','oliverliddiard@outlook.com','07548 641484',165,715],
    ['Claypath Flat 2','Taormina Pippinita Kaur Plummer','','pipplummer@icloud.com','07729 446295',165,715],
    ['Claypath Flat 2','Eloise Sophie Greig','','greigeloise@gmail.com','07587 895316',165,715],
    ['Claypath Flat 2','Edward Milo Childs','','teddychilds67@gmail.com','07913 725992',165,715],
    ['Claypath Flat 2','Felix Cay Henning Graf Brockdorff Ahlefeldt','','felix.brockdorff@gmail.com','07488 378004',165,715],
    ['Claypath Flat 3','William Porter','','wbenedictp@gmail.com','07500 504932',165,715],
    ['Claypath Flat 3','Lucia McDonald','','19lulumcdonald@gmail.com','07546 433780',165,715],
    ['Claypath Flat 3','Matthew Collotta','','matthewcollotta@gmail.com','07706 626733',165,715],
    ['Claypath Flat 3','Kylie Strand','','kystrand05@gmail.com','19527377016',165,715],
    ['Claypath Flat 3','Federica Maria Brillembourg Wallis','','bww.federica@gmail.com','07341 909715',165,715],
    ['Claypath Flat 3','Zoe Chapman','','zoechapman012@gmail.com','07721 963777',165,715],
    ['Claypath Flat 4','Samuel Earnshaw','','samuelearnshaw@icloud.com','07889 712351',165,715],
    ['Claypath Flat 4','Kofi Okyere','','kofi.s.okyere@gmail.com','07481 237167',165,715],
    ['Claypath Flat 4','Roni Cakmak','','ronicakmak12@gmail.com','07504 531137',165,715],
    ['Claypath Flat 4','Lucas Fisher','','lucasmacleanfisher@gmail.com','07484 874503',165,715],
    ['Claypath Flat 4','Luke Palmer','','lukewenjie@icloud.com','07570 088423',165,715],
    ['Claypath Flat 4','Henry Richardson','','henry.richardson.farm@gmail.com','07432 691330',165,715],
    ['35 St Andrews Court','Mingtong Wei','','m18610465852@163.com','07901 198460',0,0],
    ['35 St Andrews Court','Yuxin Yan','','13290695118@163.com','07303 091864',0,0],
    ['7 Cathedrals','Nuo Xu','','xun377375@gmail.com','07776 269327',0,0],
    ['24 Hallgarth Street','Ashley Wright','','wrightsclan2@gmail.com','07759 077416',0,0],
    ['24 Hallgarth Street','Karan Wright','','wrightsclan@icloud.com','07522 859026',0,0],
  ];

  // 2026-2027 tenants (61 tenants, tenancy Jul 2026 → Jun 2027)
  const t2627 = [
    ['33 Old Elvet','James Sullivan','','james_sullivan27@hotmail.com','07578 364089',195,845],
    ['33 Old Elvet','Ronan Pitt','','ronan04pitt@gmail.com','07543 188520',195,845],
    ['33 Old Elvet','Kian Nooralahiyan','','kian5505@gmail.com','07375 903863',195,845],
    ['33 Old Elvet','Daniel Clamp','','dgclamp@gmail.com','07763 641748',195,845],
    ['33 Old Elvet','Thomas Yates','','tomyates4243@gmail.com','07498 798671',195,845],
    ['33 Old Elvet','Fraser Brannigan','','fjbrannigan05@gmail.com','07565 975679',195,845],
    ['33 Old Elvet','Aryen Patel','','aryenpatel1@gmail.com','07985 785945',195,845],
    ['2B, Flass Court','Jake Scott','','jakealanscott2002@gmail.com','07714 696464',195,845],
    ['2B, Flass Court','Alice Henderson','','alicehhenderson05@gmail.com','07848 845548',195,845],
    ['2B, Flass Court','Dominic Cusco','','dominiclcusco@gmail.com','07594 386654',195,845],
    ['2B, Flass Court','Lilydee Bell','','belllilydee@gmail.com','07903 815111',195,845],
    ['2A, Flass Court','Layla Grace Lynch','','laylagracelynch11@outlook.com','07392 981398',195,845],
    ['2A, Flass Court','Anastasia Agapi Gkenakou','','anastasiaagapi.gkenakou@gmail.com','07477 180457',195,845],
    ['2A, Flass Court','Francesca Rose Seymour','','roseseymour2006@icloud.com','07340 212401',195,845],
    ['2A, Flass Court','Cara Eliza Lee','','caraelizalee@icloud.com','07745 735675',195,845],
    ['Flass Court Lower','Francesca Alice Harber','','francescaharber89@gmail.com','07511 991590',190,823],
    ['Flass Court Lower','Jemima Byatt','','jemimabyatt.jb@gmail.com','07388 271608',190,823],
    ['Flass Court Lower','Charlotte Emily-Grace Turner','','lottieturner8@icloud.com','07875 380909',190,823],
    ['Flass Court Lower','Phoebe Natasha Martin','','phoebenmartin@icloud.com','07377 793528',190,823],
    ['Flass Court Lower','Rose Daly-Shone','','rosedalyshone@icloud.com','07818 670115',190,823],
    ['Flass House Upper','Kate Barnes','','katebarnesknutsford@icloud.com','07932 836016',150,650],
    ['Flass House Upper','Isabella Bowkett-Brett','','izzybb8@icloud.com','07594 989639',150,650],
    ['Flass House Upper','Jude Morgan Pearce','','judempearce9@gmail.com','07568 244947',150,650],
    ['Flass House Upper','Madelaine Brindley','','maddiebrindley@icloud.com','07944 633623',150,650],
    ['Flass House Upper','Harriet Elizabeth Medlen','','harrietmed100@gmail.com','07789 971902',150,650],
    ['Flass House Upper','Jack Joseph Warne Joyce','','joycejack821@gmail.com','07535 129715',150,650],
    ['Flass House Upper','Oliver George Higginbotham','','ollie.higginbotham@icloud.com','07484 361334',150,650],
    ['Flass House Upper','Genna Walker','','gennaw57@icloud.com','07376 146366',150,650],
    ['Flass House Lower','Eliza Kelleher','','ekelleher06@gmail.com','07702 288332',150,650],
    ['Flass House Lower','Lucy Pettifer','','lucy.pettifer@icloud.com','07946 067082',150,650],
    ['Flass House Lower','Florence Wood','','florenceellawood@gmail.com','07902 664925',150,650],
    ['Flass House Lower','Angelica Marson','','angelmarson@icloud.com','07496 523409',150,650],
    ['Flass House Lower','Lauren Gant','','laurengant1@icloud.com','07821 103768',150,650],
    ['Flass House Lower','Scarlett Turnbull','','scarlett.turnbull1@icloud.com','07546 948592',150,650],
    ['Claypath Flat 1','Daisy Florence Sackville-Ford','','daisysford@icloud.com','07380 534546',165,715],
    ['Claypath Flat 1','Chloe Sarah Harris','','chloesarah04@gmail.com','07432 583450',165,715],
    ['Claypath Flat 1','Katie Elizabeth Barriball','','barriball29@btinternet.com','07484 607246',165,715],
    ['Claypath Flat 1','Grace Nicole Booth','','gracenicolebooth@outlook.com','07778 674448',165,715],
    ['Claypath Flat 1','Elisabeth Rose McLaughlin','','mclaughline17@icloud.com','07547 897019',165,715],
    ['Claypath Flat 2','Ella Louisa Catherine Mitchell','','ellamitchell131@gmail.com','07932 388204',165,715],
    ['Claypath Flat 2','George Stanley Bendle','','bendlegeorge7@gmail.com','07988 808996',165,715],
    ['Claypath Flat 2','Alasdair Philip Hutcheson','','alhutcheson06@gmail.com','07999 484002',165,715],
    ['Claypath Flat 2','Niamh Mann','','niamhmann05@gmail.com','07722 177254',165,715],
    ['Claypath Flat 2','Luca Khan','','sluca.91804@gmail.com','07465 962370',165,715],
    ['Claypath Flat 3','Jake Milo Abbotts','','jakeabbotts@btinternet.com','07756 601782',165,715],
    ['Claypath Flat 3','Jack Harry Williams','','jackhwilliams198@gmail.com','07425 141611',165,715],
    ['Claypath Flat 3','Ella Lynch','','ella.lynch.07@gmail.com','07508 617322',165,715],
    ['Claypath Flat 3','Sofia Anna Rodrigues Steadman','','sofia.steadman0703@btinternet.com','07565 253959',165,715],
    ['Claypath Flat 3','Veli Can Sugecmez','','velicansugecmez@gmail.com','07429 104692',165,715],
    ['Claypath Flat 3','Joanna Maria Widyma','','jwidyma07@gmail.com','07598 566893',165,715],
    ['Claypath Flat 4','Harry Andrew Smith','','harryasmith70@icloud.com','07449 262574',165,715],
    ['Claypath Flat 4','Ch Mohammad Suleman Gondal','','sulemangondal12@gmail.com','07981 844156',165,715],
    ['Claypath Flat 4','Darius Chia','','darius.chia2003@gmail.com','07379 452661',165,715],
    ['Claypath Flat 4','Zethan Britto','','rkbr61@durham.ac.uk','07368 595508',165,715],
    ['Claypath Flat 4','Gareth Zhi Kang Lee','','lvmx41@durham.ac.uk','07780 941284',165,715],
    ['Claypath Flat 4','Noah James Ligertwood','','zhxy23@durham.ac.uk','07592 741772',165,715],
    ['35 St Andrews Court','Mingtong Wei','','m18610465852@163.com','07901 198460',0,0],
    ['35 St Andrews Court','Yuxin Yan','','13290695118@163.com','07303 091864',0,0],
    ['7 Cathedrals','Jiajia Jiang','','sabrinantnana@163.com','07536 946123',0,0],
    ['24 Hallgarth Street','Ashley Wright','','wrightsclan2@gmail.com','07759 077416',0,0],
    ['24 Hallgarth Street','Karan Wright','','wrightsclan@icloud.com','07522 859026',0,0],
  ];

  // 52 Old Elvet apartment tenants
  const t52oe = [
    ['The Villiers','Abdullah Al Sabah','000918911','abdulla.al-sabah@Durham.ac.uk','+965 9996 6088'],
    ['The Barrington','Peiwei Xia','000940081','penny_xia@outlook.com','07510918012'],
    ['The Egerton','Jessica Kayll','','Jesskayll@hotmail.com','07516 827146'],
    ['The Egerton','Mark Fisch','','',''],
    ['The Wolsey','Kunlin Meng','000985036','mklcici@163.com','+86 15022663033'],
    ['The Wolsey','Hanzun Zhang','000991662','zhz990918@163.com','+86 15967598303'],
    ['The Tunstall','Alex Pritchard','','twentyonehomesltd@gmail.com','07950 789394'],
    ['The Montague','Phillips Baker','000921720','psabaker3@gmail.com','07342 179630'],
    ['The Montague','Vedika Dhoot','000884460','vdhoot01@gmail.com','07466 832238'],
    ['The Montague','Vanshika Dhoot','000968108','',''],
    ['The Morton','Daniel Connor Jones','000980953','daniel.connor.jones@gmail.com','07704 535129'],
    ['The Gray','Hamza Hakeem','000975518','hamzahakeem007@hotmail.com','+92 301 8475657'],
    ['The Kirkham','Ekaterina Karsakova','000884440','e.karsakova@outlook.com','+79093784805'],
    ['The Talbot Penthouse','Phillips Baker','000921720','psabaker3@gmail.com','07342 179630'],
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
  const c2 = seedBatch(t2627, '2026-2027', '2026-07-01', '2027-06-30', false);
  const c3 = seedBatch(t52oe, '2025-2026', '2025-07-01', '2026-06-30', true);
  if (c1 + c2 + c3 > 0) console.log(`  Tenants seeded: ${c1} (25-26) + ${c2} (26-27) + ${c3} (52 OE)`);
}

// Graceful shutdown - close DB properly on process exit
process.on('SIGTERM', () => { if (_db) { _db.close(); _db = null; } });
process.on('SIGINT', () => { if (_db) { _db.close(); _db = null; } process.exit(0); });

module.exports = { getDb, initialiseDatabase, DB_PATH };
