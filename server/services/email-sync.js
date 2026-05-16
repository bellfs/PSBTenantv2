/**
 * Email Sync Service
 * Handles Gmail OAuth email scanning for tenant issue detection.
 * Scans connected Gmail accounts, matches senders to tenants,
 * and uses AI to extract maintenance issues from emails.
 */

const { getDb } = require('../database');
const { v4: uuidv4 } = require('uuid');
const { sendNewIssueEmail } = require('./email');

// ===== GMAIL OAUTH =====

let google = null;
try {
  google = require('googleapis').google;
} catch (e) {
  console.log('[EmailSync] googleapis not installed - Gmail sync disabled');
}

function getGmailOAuth2Client() {
  if (!google) throw new Error('googleapis package not installed. Run: npm install googleapis');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://maintenance.52oldelvet.com/api/email/accounts/gmail/callback';
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required. Set them in Railway.');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getGmailAuthUrl() {
  const oauth2Client = getGmailOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
}

async function handleGmailCallback(code) {
  const oauth2Client = getGmailOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user email
  let email = 'unknown@gmail.com';
  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    email = profile.data.emailAddress;
  } catch (e) { console.log('[Gmail] Could not get profile:', e.message); }

  // Store in DB without replacing the row. Sync logs, agent items and Gmail drafts
  // point at email_accounts.id, so reconnecting must preserve the existing id.
  const db = getDb();
  try {
    const existing = db.prepare('SELECT id FROM email_accounts WHERE provider = ? AND LOWER(email_address) = LOWER(?)').get('gmail', email);
    let id;
    if (existing) {
      db.prepare(`
        UPDATE email_accounts
        SET credentials = ?, sync_enabled = 1
        WHERE id = ?
      `).run(JSON.stringify(tokens), existing.id);
      id = existing.id;
    } else {
      id = db.prepare('INSERT INTO email_accounts (provider, email_address, credentials, sync_enabled) VALUES (?, ?, ?, 1)')
        .run('gmail', email, JSON.stringify(tokens)).lastInsertRowid;
    }
    console.log(`[Gmail] Connected: ${email}`);
    return { id, email, provider: 'gmail' };
  } finally { db.close(); }
}

async function syncGmailAccount(account) {
  if (!google) return { processed: 0, matched: 0, issues: 0, error: 'googleapis not installed' };
  const oauth2Client = getGmailOAuth2Client();
  const tokens = JSON.parse(account.credentials);
  oauth2Client.setCredentials(tokens);

  // Refresh token if needed
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      const db = getDb();
      db.prepare('UPDATE email_accounts SET credentials = ? WHERE id = ?').run(JSON.stringify(credentials), account.id);
      db.close();
    } catch (e) {
      console.error('[Gmail] Token refresh failed:', e.message);
      return { processed: 0, matched: 0, issues: 0, error: 'Token refresh failed - reconnect Gmail in Settings' };
    }
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Get messages from last 3 days (broader window for manual scans)
  const after = Math.floor((Date.now() - 3 * 86400000) / 1000);
  const query = `after:${after} -from:me`;

  try {
    const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 50 });
    const messages = listRes.data.messages || [];
    let processed = 0, matched = 0, issuesCreated = 0;

    for (const msg of messages) {
      const db = getDb();
      // Skip if already processed
      const existing = db.prepare('SELECT id FROM email_sync_log WHERE message_id = ?').get(msg.id);
      db.close();
      if (existing) continue;

      // Get full message
      const fullMsg = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = fullMsg.data.payload?.headers || [];
      const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
      const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';

      // Extract email address and name from "Name <email>" format
      const emailMatch = from.match(/<(.+?)>/);
      const fromEmail = emailMatch ? emailMatch[1] : from.trim();
      const fromName = emailMatch ? from.replace(/<.+?>/, '').trim().replace(/"/g, '') : '';

      // Get body text (handle nested MIME parts)
      let body = extractBodyText(fullMsg.data.payload);

      processed++;
      const result = await processEmail(account.id, msg.id, fromEmail, fromName, subject, body, { gmailThreadId: fullMsg.data.threadId });
      if (result.matched) matched++;
      if (result.issueCreated) issuesCreated++;
    }

    // Update last sync time
    const db2 = getDb();
    db2.prepare('UPDATE email_accounts SET last_sync_at = CURRENT_TIMESTAMP WHERE id = ?').run(account.id);
    db2.close();

    return { processed, matched, issues: issuesCreated };
  } catch (e) {
    console.error('[Gmail] Sync error:', e.message);
    return { processed: 0, matched: 0, issues: 0, error: e.message };
  }
}

// Recursively extract plain text body from Gmail message payload
function extractBodyText(payload) {
  if (!payload) return '';

  // Direct body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Multipart - look for text/plain first, then text/html
  if (payload.parts) {
    // Try text/plain first
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
    }
    // Try nested multipart
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/')) {
        const nested = extractBodyText(part);
        if (nested) return nested;
      }
    }
    // Fallback to text/html stripped of tags
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  return '';
}

// ===== IMAP (Zoho / Other) =====

let ImapSimple = null;
try {
  ImapSimple = require('imap-simple');
} catch (e) {
  console.log('[EmailSync] imap-simple not installed - IMAP disabled');
}

function buildImapConfig(config) {
  return {
    imap: {
      host: config.host,
      port: config.port || 993,
      tls: true,
      user: config.username,
      password: config.password,
      authTimeout: 20000,
      connTimeout: 20000,
      tlsOptions: { rejectUnauthorized: false, servername: config.host },
      keepalive: { interval: 10000, idleInterval: 300000, forceNoop: true }
    }
  };
}

async function testImapConnection(config) {
  if (!ImapSimple) throw new Error('imap-simple package not installed. The server needs to be redeployed.');
  console.log(`[IMAP] Testing connection to ${config.host}:${config.port || 993} as ${config.username}`);
  try {
    const connection = await ImapSimple.connect(buildImapConfig(config));
    // Verify we can open INBOX
    await connection.openBox('INBOX');
    await connection.end();
    console.log(`[IMAP] Connection test passed for ${config.username}`);
    return true;
  } catch (e) {
    console.error(`[IMAP] Connection test FAILED for ${config.username}@${config.host}: ${e.message}`);
    // Give a more helpful error message
    if (e.message.includes('AUTHENTICATIONFAILED') || e.message.includes('LOGIN')) {
      throw new Error(`Authentication failed. Check your email/password. For Zoho, use an App Password from accounts.zoho.eu > Security > App Passwords. Also ensure IMAP is enabled in Zoho Mail Settings.`);
    }
    if (e.message.includes('ENOTFOUND') || e.message.includes('getaddrinfo')) {
      throw new Error(`Cannot reach ${config.host}. For Zoho EU custom domains, try imappro.zoho.eu. For US accounts, try imappro.zoho.com.`);
    }
    if (e.message.includes('ETIMEDOUT') || e.message.includes('timeout')) {
      throw new Error(`Connection timed out to ${config.host}. Try imappro.zoho.eu (EU) or imappro.zoho.com (US).`);
    }
    throw e;
  }
}

async function syncImapAccount(account) {
  if (!ImapSimple) return { processed: 0, matched: 0, issues: 0, error: 'imap-simple not installed' };
  const creds = JSON.parse(account.credentials);

  console.log(`[IMAP] Syncing ${account.email_address} via ${creds.host}`);

  try {
    const connection = await ImapSimple.connect(buildImapConfig(creds));

    await connection.openBox('INBOX');

    // Search for emails from last 7 days - pass Date object for IMAP compatibility
    const since = new Date(Date.now() - 7 * 86400000);
    const searchCriteria = [['SINCE', since]];
    const fetchOptions = { bodies: ['HEADER', 'TEXT'], struct: true };

    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`[IMAP] Found ${messages.length} messages in last 7 days for ${account.email_address}`);
    let processed = 0, matched = 0, issuesCreated = 0;

    for (const msg of messages) {
      // Use account ID + UID for unique message ID across accounts
      const uid = msg.attributes?.uid?.toString() || `${Date.now()}-${Math.random()}`;
      const msgId = `imap-${account.id}-${uid}`;
      const db = getDb();
      const existing = db.prepare('SELECT id FROM email_sync_log WHERE message_id = ?').get(msgId);
      db.close();
      if (existing) continue;

      const header = msg.parts?.find(p => p.which === 'HEADER')?.body || {};
      const from = (header.from || [''])[0];
      const subject = (header.subject || [''])[0];

      const textPart = msg.parts?.find(p => p.which === 'TEXT');
      const body = textPart?.body || '';

      const emailMatch = from.match(/<(.+?)>/);
      const fromEmail = emailMatch ? emailMatch[1] : from.trim();
      const fromName = emailMatch ? from.replace(/<.+?>/, '').trim().replace(/"/g, '') : '';

      console.log(`[IMAP] Processing: from=${fromEmail} subject="${subject?.slice(0, 60)}"`);

      processed++;
      const result = await processEmail(account.id, msgId, fromEmail, fromName, subject, body);
      if (result.matched) matched++;
      if (result.issueCreated) issuesCreated++;
    }

    await connection.end();

    const db2 = getDb();
    db2.prepare('UPDATE email_accounts SET last_sync_at = CURRENT_TIMESTAMP WHERE id = ?').run(account.id);
    db2.close();

    console.log(`[IMAP] Sync complete for ${account.email_address}: processed=${processed} matched=${matched} issues=${issuesCreated}`);
    return { processed, matched, issues: issuesCreated };
  } catch (e) {
    console.error('[IMAP] Sync error:', e.message);
    return { processed: 0, matched: 0, issues: 0, error: e.message };
  }
}

// ===== SHARED EMAIL PROCESSING =====

async function processEmail(accountId, messageId, fromEmail, fromName, subject, body, metadata = {}) {
  const db = getDb();
  let matchedTenantId = null;
  let issueCreated = false;

  try {
    // Step 1: Match sender to tenant
    // Direct email match
    let tenant = db.prepare('SELECT t.*, p.name as property_name FROM tenants t LEFT JOIN properties p ON t.property_id = p.id WHERE LOWER(t.email) = LOWER(?)').get(fromEmail);

    // Fuzzy name match if no direct email match
    if (!tenant && fromName) {
      const nameParts = fromName.toLowerCase().split(/\s+/);
      if (nameParts.length >= 2) {
        tenant = db.prepare('SELECT t.*, p.name as property_name FROM tenants t LEFT JOIN properties p ON t.property_id = p.id WHERE LOWER(t.name) LIKE ? AND LOWER(t.name) LIKE ?')
          .get(`%${nameParts[0]}%`, `%${nameParts[nameParts.length-1]}%`);
      }
    }

    if (tenant) {
      matchedTenantId = tenant.id;

      // Step 2: Check if email looks like a maintenance issue
      const isMaintenanceRelated = checkMaintenanceRelevance(subject, body);

      if (isMaintenanceRelated) {
        // Step 3: Use AI to extract issue details
        try {
          const issueData = await extractIssueFromEmail(subject, body, tenant);
          if (issueData) {
            // Create the issue
            const uuid = uuidv4().split('-')[0].toUpperCase();
            const result = db.prepare(`
              INSERT INTO issues (uuid, tenant_id, property_id, flat_number, category, title, description, status, priority, ai_diagnosis, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(uuid, tenant.id, tenant.property_id, tenant.flat_number, issueData.category, issueData.title, issueData.description, issueData.priority || 'medium', issueData.diagnosis || '');

            // Add first message
            db.prepare('INSERT INTO messages (issue_id, sender, content, message_type) VALUES (?, ?, ?, ?)')
              .run(result.lastInsertRowid, 'tenant', `[From email: ${subject}]\n\n${body.slice(0, 2000)}`, 'text');

            // Log activity
            db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)')
              .run(result.lastInsertRowid, 'email_issue_created', `Auto-created from email by ${fromName} <${fromEmail}>`, 'system');

            issueCreated = true;

            // Send new issue email notification
            const newIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(result.lastInsertRowid);
            const property = tenant.property_id ? db.prepare('SELECT * FROM properties WHERE id = ?').get(tenant.property_id) : null;
            const issueMessages = db.prepare('SELECT * FROM messages WHERE issue_id = ? ORDER BY created_at ASC').all(result.lastInsertRowid);
            sendNewIssueEmail({ issue: newIssue, tenant, property, messages: issueMessages, attachments: [] })
              .catch(e => console.error('[EmailSync] New issue email failed:', e.message));

            // Log to sync log
            db.prepare('INSERT OR IGNORE INTO email_sync_log (email_account_id, message_id, from_address, subject, matched_tenant_id, issue_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(accountId, messageId, fromEmail, subject, tenant.id, result.lastInsertRowid, 'issue_created');

            await handToEmailAgent({
              accountId,
              messageId,
              gmailThreadId: metadata.gmailThreadId || null,
              fromEmail,
              fromName,
              subject,
              body,
              matchedTenantId: tenant.id,
              issueId: result.lastInsertRowid,
              status: 'issue_created'
            });

            return { matched: true, issueCreated: true };
          }
        } catch (e) {
          console.error('[EmailSync] AI extraction error:', e.message);
        }
      }
    }

    // Log non-matched or non-maintenance emails
    db.prepare('INSERT OR IGNORE INTO email_sync_log (email_account_id, message_id, from_address, subject, matched_tenant_id, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, messageId, fromEmail, subject, matchedTenantId, matchedTenantId ? 'matched' : 'processed');

    await handToEmailAgent({
      accountId,
      messageId,
      gmailThreadId: metadata.gmailThreadId || null,
      fromEmail,
      fromName,
      subject,
      body,
      matchedTenantId,
      issueId: null,
      status: matchedTenantId ? 'matched' : 'processed'
    });

    return { matched: !!matchedTenantId, issueCreated: false };
  } finally { db.close(); }
}

async function handToEmailAgent(payload) {
  try {
    const { recordEmailItem } = require('./email-agent');
    await recordEmailItem(payload);
  } catch (error) {
    console.error('[EmailAgent] Could not record email item:', error.message);
  }
}

function checkMaintenanceRelevance(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  const keywords = [
    'repair', 'broken', 'leak', 'damage', 'fix', 'maintenance', 'fault', 'issue',
    'heating', 'boiler', 'plumbing', 'electrical', 'damp', 'mould', 'mold',
    'window', 'door', 'lock', 'toilet', 'shower', 'sink', 'tap', 'radiator',
    'noise', 'pest', 'bug', 'mice', 'rat', 'cockroach', 'ant',
    'water', 'flood', 'drip', 'crack', 'hole', 'stain', 'smell',
    'not working', 'doesn\'t work', 'won\'t work', 'stopped working',
    'urgent', 'emergency', 'dangerous', 'safety',
  ];
  return keywords.some(kw => text.includes(kw));
}

async function extractIssueFromEmail(subject, body, tenant) {
  try {
    const { callLLM } = require('./llm');
    const prompt = `You are analysing an email that appears to be a property maintenance issue report from a tenant.

Email Subject: ${subject}
Email Body: ${body.slice(0, 3000)}

Tenant: ${tenant.name} at ${tenant.property_name || 'unknown property'}

Extract the following in JSON format:
{
  "title": "Brief title of the maintenance issue (max 80 chars)",
  "description": "Clear description of the issue",
  "category": "One of: plumbing, electrical, heating, structural, pest_control, appliance, general, other",
  "priority": "One of: low, medium, high, urgent",
  "diagnosis": "Brief AI diagnosis of the likely issue and suggested action"
}

If the email is NOT about a maintenance/repair issue, return null.
Return ONLY valid JSON, no markdown or explanation.`;

    const response = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 500 });
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    if (cleaned === 'null') return null;
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[EmailSync] LLM extraction failed:', e.message);
    return null;
  }
}

// ===== SYNC SCHEDULER =====

let syncInterval = null;

async function syncAllAccounts() {
  const db = getDb();
  let accounts;
  try {
    accounts = db.prepare('SELECT * FROM email_accounts WHERE sync_enabled = 1').all();
  } finally { db.close(); }

  if (!accounts || accounts.length === 0) return { accounts: 0, processed: 0, matched: 0, issues: 0, results: [] };

  let totalProcessed = 0, totalMatched = 0, totalIssues = 0;
  const results = [];

  for (const account of accounts) {
    try {
      let result;
      if (account.provider === 'gmail') {
        result = await syncGmailAccount(account);
      } else if (account.provider === 'imap') {
        result = await syncImapAccount(account);
      }
      if (result) {
        totalProcessed += result.processed || 0;
        totalMatched += result.matched || 0;
        totalIssues += result.issues || 0;
        results.push({ account: account.email_address, provider: account.provider, ...result });
        if (result.processed > 0 || result.error) {
          console.log(`[EmailSync] ${account.email_address} - processed:${result.processed} matched:${result.matched} issues:${result.issues}${result.error ? ' error:'+result.error : ''}`);
        }
      }
    } catch (e) {
      console.error(`[EmailSync] Error syncing ${account.email_address}:`, e.message);
      results.push({ account: account.email_address, provider: account.provider, error: e.message });
    }
  }

  return { accounts: accounts.length, processed: totalProcessed, matched: totalMatched, issues: totalIssues, results };
}

// Detailed scan for UI - returns recent sync log entries after scanning
async function scanAllAccountsDetailed() {
  const scanResult = await syncAllAccounts();

  // Get the most recent sync log entries created during this scan
  const db = getDb();
  try {
    const recentLogs = db.prepare(`
      SELECT l.*, t.name as tenant_name, t.flat_number, p.name as property_name,
        i.uuid as issue_uuid, i.title as issue_title, i.status as issue_status, i.priority as issue_priority
      FROM email_sync_log l
      LEFT JOIN tenants t ON l.matched_tenant_id = t.id
      LEFT JOIN issues i ON l.issue_id = i.id
      LEFT JOIN properties p ON t.property_id = p.id
      ORDER BY l.processed_at DESC
      LIMIT 50
    `).all();
    return { ...scanResult, recentLogs };
  } finally { db.close(); }
}

function startSyncScheduler() {
  if (syncInterval) return;
  syncInterval = setInterval(syncAllAccounts, 5 * 60 * 1000);
  setTimeout(syncAllAccounts, 30000);
  console.log('[EmailSync] Scheduler started (5-min interval)');
}

function stopSyncScheduler() {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}

module.exports = {
  getGmailAuthUrl,
  handleGmailCallback,
  syncGmailAccount,
  testImapConnection,
  syncImapAccount,
  syncAllAccounts: scanAllAccountsDetailed,
  startSyncScheduler,
  stopSyncScheduler,
};
