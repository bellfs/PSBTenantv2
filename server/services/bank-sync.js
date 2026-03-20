/**
 * Bank Sync Service
 * Read-only integrations with Starling Bank, Wise, and Pleo
 */
const axios = require('axios');
const { getDb } = require('../database');

// ========== STARLING BANK ==========
// Docs: https://developer.starlingbank.com/docs

async function syncStarling(accountId) {
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND provider = ?').get(accountId, 'starling');
  if (!account || !account.access_token) throw new Error('Starling account not configured');

  const headers = { Authorization: `Bearer ${account.access_token}`, Accept: 'application/json' };
  const baseUrl = 'https://api.starlingbank.com/api/v2';

  // Get account details & balance
  try {
    const accRes = await axios.get(`${baseUrl}/accounts`, { headers, timeout: 15000 });
    const starlingAccount = accRes.data.accounts?.[0];
    if (!starlingAccount) throw new Error('No Starling account found');

    const accountUid = starlingAccount.accountUid;
    const categoryUid = starlingAccount.defaultCategory;

    // Get balance
    const balRes = await axios.get(`${baseUrl}/accounts/${accountUid}/balance`, { headers, timeout: 15000 });
    const balance = balRes.data.effectiveBalance?.minorUnits / 100 || 0;
    db.prepare('UPDATE bank_accounts SET balance = ?, account_id = ? WHERE id = ?').run(balance, accountUid, accountId);

    // Get transactions from last 90 days
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceStr = since.toISOString();

    const txnRes = await axios.get(
      `${baseUrl}/feed/account/${accountUid}/category/${categoryUid}?changesSince=${sinceStr}`,
      { headers, timeout: 30000 }
    );

    const transactions = txnRes.data.feedItems || [];
    let imported = 0;

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO bank_transactions
      (bank_account_id, external_id, date, amount, currency, direction, counterparty, reference, description, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const txn of transactions) {
      const amount = Math.abs(txn.amount?.minorUnits || 0) / 100;
      const direction = txn.direction === 'OUT' ? 'OUT' : 'IN';
      const date = txn.transactionTime?.split('T')[0] || txn.settlementTime?.split('T')[0];

      const result = insertStmt.run(
        accountId,
        txn.feedItemUid,
        date,
        amount,
        txn.amount?.currency || 'GBP',
        direction,
        txn.counterPartyName || '',
        txn.reference || '',
        txn.counterPartyName || txn.reference || '',
        txn.spendingCategory || ''
      );
      if (result.changes > 0) imported++;
    }

    db.prepare('UPDATE bank_accounts SET last_sync_at = CURRENT_TIMESTAMP WHERE id = ?').run(accountId);
    return { imported, total: transactions.length, balance };
  } catch (err) {
    console.error('[Starling Sync Error]', err.response?.data || err.message);
    throw new Error(err.response?.data?.error_description || err.message);
  }
}

// ========== WISE (TransferWise) ==========
// Docs: https://docs.wise.com/api-docs

async function syncWise(accountId) {
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND provider = ?').get(accountId, 'wise');
  if (!account || !account.access_token) throw new Error('Wise account not configured');

  const headers = { Authorization: `Bearer ${account.access_token}`, Accept: 'application/json' };
  const baseUrl = 'https://api.wise.com';

  try {
    // Get profiles
    const profileRes = await axios.get(`${baseUrl}/v1/profiles`, { headers, timeout: 15000 });
    const businessProfile = profileRes.data.find(p => p.type === 'BUSINESS') || profileRes.data[0];
    if (!businessProfile) throw new Error('No Wise profile found');

    const profileId = businessProfile.id;

    // Get borderless accounts (multi-currency)
    const balRes = await axios.get(`${baseUrl}/v4/profiles/${profileId}/balances?types=STANDARD`, { headers, timeout: 15000 });
    const gbpBalance = balRes.data?.find(b => b.currency === 'GBP');
    if (gbpBalance) {
      db.prepare('UPDATE bank_accounts SET balance = ? WHERE id = ?').run(gbpBalance.amount?.value || 0, accountId);
    }

    // Get the GBP account ID for statement
    const accountIdWise = gbpBalance?.id;
    if (!accountIdWise) throw new Error('No GBP balance found on Wise');

    // Get statement for last 90 days
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const until = new Date();

    const stmtRes = await axios.get(
      `${baseUrl}/v1/profiles/${profileId}/balance-statements/${accountIdWise}/statement?currency=GBP&intervalStart=${since.toISOString()}&intervalEnd=${until.toISOString()}&type=FLAT`,
      { headers, timeout: 30000 }
    );

    const transactions = stmtRes.data?.transactions || [];
    let imported = 0;

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO bank_transactions
      (bank_account_id, external_id, date, amount, currency, direction, counterparty, reference, description, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const txn of transactions) {
      const amount = Math.abs(txn.amount?.value || 0);
      const direction = (txn.amount?.value || 0) < 0 ? 'OUT' : 'IN';
      const date = (txn.date || '').split('T')[0];

      const result = insertStmt.run(
        accountId,
        txn.referenceNumber || `wise-${txn.date}-${amount}`,
        date,
        amount,
        txn.amount?.currency || 'GBP',
        direction,
        txn.details?.recipient?.name || txn.details?.merchant?.name || '',
        txn.details?.paymentReference || '',
        txn.details?.description || txn.details?.recipient?.name || '',
        txn.details?.type || ''
      );
      if (result.changes > 0) imported++;
    }

    db.prepare('UPDATE bank_accounts SET last_sync_at = CURRENT_TIMESTAMP WHERE id = ?').run(accountId);
    return { imported, total: transactions.length, balance: gbpBalance?.amount?.value || 0 };
  } catch (err) {
    console.error('[Wise Sync Error]', err.response?.data || err.message);
    throw new Error(err.response?.data?.error || err.message);
  }
}

// ========== PLEO ==========
// Docs: https://developers.pleo.io

async function syncPleo(accountId) {
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND provider = ?').get(accountId, 'pleo');
  if (!account || !account.access_token) throw new Error('Pleo account not configured');

  const headers = { Authorization: `Bearer ${account.access_token}`, Accept: 'application/json' };
  const baseUrl = 'https://external.pleo.io/v1';

  try {
    // Get company info
    const companyRes = await axios.get(`${baseUrl}/company`, { headers, timeout: 15000 });
    const companyId = companyRes.data?.id;

    // Get expenses for last 90 days
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const expRes = await axios.get(
      `${baseUrl}/expenses?companyId=${companyId}&from=${since.toISOString().split('T')[0]}&limit=500`,
      { headers, timeout: 30000 }
    );

    const expenses = expRes.data?.data || expRes.data || [];
    let imported = 0;

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO bank_transactions
      (bank_account_id, external_id, date, amount, currency, direction, counterparty, reference, description, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const exp of expenses) {
      const amount = Math.abs(exp.amount?.value || exp.amount || 0) / 100;
      const date = (exp.performedAt || exp.createdAt || '').split('T')[0];

      const result = insertStmt.run(
        accountId,
        exp.id || `pleo-${date}-${amount}`,
        date,
        amount,
        exp.amount?.currency || 'GBP',
        'OUT', // Pleo is expenses only
        exp.merchant?.name || exp.supplier || '',
        exp.note || '',
        exp.merchant?.name || exp.note || exp.supplier || '',
        exp.category?.name || ''
      );
      if (result.changes > 0) imported++;
    }

    db.prepare('UPDATE bank_accounts SET last_sync_at = CURRENT_TIMESTAMP WHERE id = ?').run(accountId);
    return { imported, total: expenses.length };
  } catch (err) {
    console.error('[Pleo Sync Error]', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || err.message);
  }
}

// ========== AI CATEGORISATION ==========
async function categoriseTransactions(transactionIds) {
  const db = getDb();
  const properties = db.prepare('SELECT id, name FROM properties').all();

  // Get uncategorised transactions
  let txns;
  if (transactionIds && transactionIds.length > 0) {
    txns = db.prepare(`SELECT * FROM bank_transactions WHERE id IN (${transactionIds.map(() => '?').join(',')})`)
      .all(...transactionIds);
  } else {
    txns = db.prepare('SELECT * FROM bank_transactions WHERE ai_category IS NULL AND direction = ? ORDER BY date DESC LIMIT 100')
      .all('OUT');
  }

  if (txns.length === 0) return { categorised: 0 };

  // Build the prompt for AI categorisation
  const propertyNames = properties.map(p => p.name).join(', ');
  const categories = [
    'plumbing', 'electrical', 'joinery', 'roofing', 'cleaning',
    'gardening', 'pest_control', 'appliance_repair', 'locksmith',
    'painting_decorating', 'building_materials', 'insurance',
    'council_tax', 'utilities_gas', 'utilities_electric', 'utilities_water',
    'mortgage', 'management_fee', 'legal', 'accounting',
    'furnishing', 'safety_compliance', 'waste_removal',
    'general_maintenance', 'staff_costs', 'office_supplies',
    'software_subscriptions', 'marketing', 'travel',
    'non_property', 'personal', 'transfer', 'unknown'
  ];

  const txnList = txns.map(t =>
    `ID:${t.id} | ${t.date} | £${t.amount.toFixed(2)} | ${t.counterparty} | ${t.reference} | ${t.description}`
  ).join('\n');

  // Try to use configured LLM
  const llmProvider = db.prepare("SELECT value FROM settings WHERE key = 'llm_provider'").get()?.value || 'openai';
  const openaiKey = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get()?.value;
  const anthropicKey = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_api_key'").get()?.value;

  const systemPrompt = `You are a property management finance assistant for PSB Properties in Durham, UK.
Categorise each bank transaction into ONE of these categories: ${categories.join(', ')}.
Also try to match transactions to properties if the counterparty or reference suggests a specific property.
Properties: ${propertyNames}.

For each transaction, respond with a JSON array of objects:
[{"id": <transaction_id>, "category": "<category>", "confidence": 0.0-1.0, "property_match": "<property name or null>"}]

Only respond with the JSON array, nothing else.`;

  try {
    let result;
    if (llmProvider === 'anthropic' && anthropicKey) {
      const res = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Categorise these transactions:\n${txnList}` }]
      }, {
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        timeout: 60000
      });
      result = res.data.content?.[0]?.text || '[]';
    } else if (openaiKey) {
      const res = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Categorise these transactions:\n${txnList}` }
        ],
        temperature: 0.1
      }, {
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000
      });
      result = res.data.choices?.[0]?.message?.content || '[]';
    } else {
      // No LLM — do basic keyword matching
      return basicCategorise(db, txns, properties);
    }

    // Parse AI response
    const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const categorised = JSON.parse(cleaned);
    let count = 0;

    for (const cat of categorised) {
      const propertyId = cat.property_match
        ? properties.find(p => p.name.toLowerCase() === cat.property_match.toLowerCase())?.id || null
        : null;

      db.prepare('UPDATE bank_transactions SET ai_category = ?, ai_confidence = ?, property_id = COALESCE(property_id, ?) WHERE id = ?')
        .run(cat.category, cat.confidence || 0.5, propertyId, cat.id);
      count++;
    }

    return { categorised: count };
  } catch (err) {
    console.error('[AI Categorisation Error]', err.message);
    // Fallback to basic categorisation
    return basicCategorise(db, txns, properties);
  }
}

function basicCategorise(db, txns, properties) {
  const keywords = {
    plumbing: ['plumb', 'pipe', 'drain', 'boiler', 'heating', 'radiator', 'water tank'],
    electrical: ['electric', 'wiring', 'socket', 'light', 'fuse', 'switch', 'spark'],
    joinery: ['joiner', 'carpenter', 'door', 'window', 'wood', 'timber', 'cabinet'],
    cleaning: ['clean', 'cleaner', 'maid', 'carpet clean', 'deep clean'],
    insurance: ['insurance', 'insure', 'policy', 'premium', 'axa', 'aviva'],
    council_tax: ['council', 'rates', 'council tax'],
    utilities_gas: ['british gas', 'gas bill', 'octopus', 'bulb', 'edf', 'eon'],
    utilities_electric: ['electric bill', 'power', 'npower'],
    building_materials: ['screwfix', 'toolstation', 'wickes', 'b&q', 'travis perkins'],
    furnishing: ['furniture', 'ikea', 'mattress', 'bed', 'sofa', 'curtain', 'argos'],
    safety_compliance: ['fire safety', 'gas safe', 'epc', 'eicr', 'legionella', 'asbestos', 'pat test'],
    gardening: ['garden', 'lawn', 'hedge', 'tree'],
    locksmith: ['lock', 'key', 'security'],
    transfer: ['transfer', 'standing order'],
    software_subscriptions: ['software', 'subscription', 'app', 'saas'],
  };

  let count = 0;
  for (const txn of txns) {
    const text = `${txn.counterparty} ${txn.reference} ${txn.description}`.toLowerCase();
    let matched = 'unknown';

    for (const [cat, kws] of Object.entries(keywords)) {
      if (kws.some(kw => text.includes(kw))) { matched = cat; break; }
    }

    // Try property match
    let propertyId = null;
    for (const prop of properties) {
      if (text.includes(prop.name.toLowerCase())) { propertyId = prop.id; break; }
    }

    db.prepare('UPDATE bank_transactions SET ai_category = ?, ai_confidence = 0.3, property_id = COALESCE(property_id, ?) WHERE id = ?')
      .run(matched, propertyId, txn.id);
    count++;
  }
  return { categorised: count };
}

// ========== SYNC ALL ==========
async function syncAccount(accountId) {
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('Account not found');

  switch (account.provider) {
    case 'starling': return syncStarling(accountId);
    case 'wise': return syncWise(accountId);
    case 'pleo': return syncPleo(accountId);
    default: throw new Error(`Unknown provider: ${account.provider}`);
  }
}

module.exports = { syncStarling, syncWise, syncPleo, syncAccount, categoriseTransactions };
