const { getDb } = require('../database');
const { sendGenericEmail } = require('./email');

let google = null;
try {
  google = require('googleapis').google;
} catch (error) {
  console.log('[EmailAgent] googleapis not installed - Gmail draft creation disabled');
}

const DEFAULT_TEAM_RECIPIENTS = [
  'andy@52oldelvet.com',
  'akiel@52oldelvet.com',
  'hannah@52oldelvet.com',
  'fergus@fiftytwo-group.com'
];

function getTeamRecipients() {
  return (process.env.EMAIL_AGENT_TEAM_RECIPIENTS || DEFAULT_TEAM_RECIPIENTS.join(','))
    .split(',')
    .map(email => email.trim())
    .filter(Boolean);
}

function getManagedInbox() {
  return (process.env.EMAIL_AGENT_INBOX || 'admin@52oldelvet.com').toLowerCase();
}

function isManagedInboxAccount(account) {
  return account?.email_address?.toLowerCase() === getManagedInbox();
}

function getGmailOAuth2Client() {
  if (!google) throw new Error('googleapis package not installed');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://maintenance.52oldelvet.com/api/email/accounts/gmail/callback';
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required');
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function sanitizeHeader(value = '') {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeRawEmail(raw) {
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createGmailDraft(account, { to, subject, bodyText, threadId }) {
  if (!account || account.provider !== 'gmail') return null;
  const oauth2Client = getGmailOAuth2Client();
  const tokens = JSON.parse(account.credentials || '{}');
  oauth2Client.setCredentials(tokens);

  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const nextCredentials = { ...tokens, ...credentials, refresh_token: credentials.refresh_token || tokens.refresh_token };
    oauth2Client.setCredentials(nextCredentials);
    const db = getDb();
    try {
      db.prepare('UPDATE email_accounts SET credentials = ? WHERE id = ?').run(JSON.stringify(nextCredentials), account.id);
    } finally {
      db.close();
    }
  }

  const raw = [
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyText || ''
  ].join('\r\n');

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const requestBody = { message: { raw: encodeRawEmail(raw) } };
  if (threadId) requestBody.message.threadId = threadId;
  const response = await gmail.users.drafts.create({ userId: 'me', requestBody });
  return response.data;
}

function todayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.EMAIL_AGENT_TIMEZONE || 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getLocalTimeParts(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.EMAIL_AGENT_TIMEZONE || 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = Number(part.value);
    return acc;
  }, {});
}

function truncate(value = '', max = 1200) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function firstName(nameOrEmail = '') {
  const value = String(nameOrEmail || '').trim();
  if (!value) return '';
  if (value.includes('@')) return '';
  return value.split(/\s+/)[0].replace(/[^a-z'-]/gi, '');
}

function isNoReplyAddress(email = '') {
  return /(^|[._-])(no-?reply|donotreply|noreply|notifications?|alerts?)([._-]|@)/i.test(email);
}

function classifyEmail({ subject = '', body = '', fromEmail = '', fromName = '', tenant = null, issueId = null }) {
  const text = `${subject}\n${body}`.toLowerCase();
  const has = (...patterns) => patterns.some(pattern => pattern.test(text));

  let domain = 'operations';
  if (issueId || has(/repair/, /broken/, /leak/, /heating/, /boiler/, /plumb/, /electric/, /damp/, /mould/, /toilet/, /shower/, /lock/, /window/, /door/)) {
    domain = 'maintenance';
  }
  if (has(/invoice/, /payment/, /paid/, /arrears?/, /rent/, /deposit/, /refund/, /statement/, /receipt/, /bank/, /transfer/)) {
    domain = 'finance';
  }
  if (has(/gas safety/, /\beicr\b/, /\bepc\b/, /\bhmo\b/, /fire/, /alarm/, /certificate/, /licen[cs]e/, /notice/, /legal/)) {
    domain = 'compliance';
  }
  if (has(/contract/, /tenancy/, /guarantor/, /viewing/, /reservation/, /move[- ]?in/, /move[- ]?out/, /keys?/, /rent offer/)) {
    domain = 'leasing';
  }
  if (has(/booking/, /guest/, /airbnb/, /guesty/, /cleaning/, /linen/, /check[- ]?in/, /check[- ]?out/)) {
    domain = 'short_lets';
  }
  if (has(/utility/, /meter/, /electricity/, /water bill/, /gas bill/, /supplier/, /octopus/, /edf/, /british gas/)) {
    domain = 'utilities';
  }
  if (has(/quote/, /contractor/, /job complete/, /attendance/, /call[- ]?out/, /day rate/)) {
    domain = 'contractors';
  }

  let priority = 'medium';
  if (has(/urgent/, /emergency/, /asap/, /immediately/, /no heating/, /no hot water/, /active leak/, /flood/, /fire/, /break[- ]?in/, /unsafe/, /danger/)) {
    priority = 'urgent';
  } else if (has(/chase/, /overdue/, /deadline/, /today/, /tomorrow/, /complaint/, /unhappy/, /final notice/)) {
    priority = 'high';
  } else if (has(/fyi/, /for your records/, /newsletter/, /statement attached/)) {
    priority = 'low';
  }

  const needsReply = !isNoReplyAddress(fromEmail) && (
    /\?/.test(subject) ||
    /\?/.test(body) ||
    has(/can you/, /could you/, /please/, /let me know/, /confirm/, /advise/, /reply/, /respond/, /follow up/, /chase/) ||
    domain !== 'operations'
  );

  const needsTeamFollowup = priority !== 'low' && (
    domain !== 'operations' ||
    has(/need to/, /please can/, /can someone/, /make sure/, /book/, /arrange/, /send/, /pay/, /approve/, /sign/, /deadline/, /chase/)
  );

  const highRisk = domain === 'finance' || domain === 'compliance' || has(/legal/, /notice/, /deposit/, /payment/, /bank/, /contract/, /evict/, /claim/, /refund/);
  const ownerByDomain = {
    maintenance: 'andy@52oldelvet.com',
    contractors: 'andy@52oldelvet.com',
    finance: 'akiel@52oldelvet.com',
    utilities: 'akiel@52oldelvet.com',
    leasing: 'hannah@52oldelvet.com',
    short_lets: 'hannah@52oldelvet.com',
    compliance: 'fergus@fiftytwo-group.com',
    development: 'fergus@fiftytwo-group.com',
    operations: 'hannah@52oldelvet.com'
  };

  const sender = fromName || fromEmail || 'Unknown sender';
  const summary = truncate(`${sender}: ${subject || 'No subject'}`, 180);
  const suggestedAction = needsTeamFollowup
    ? `Review ${domain.replace(/_/g, ' ')} email and decide owner/action.`
    : 'File for awareness unless further context arrives.';

  return {
    domain,
    priority,
    needs_reply: needsReply ? 1 : 0,
    needs_team_followup: needsTeamFollowup ? 1 : 0,
    suggested_owner: ownerByDomain[domain] || ownerByDomain.operations,
    summary,
    risk_level: highRisk ? 'high' : priority === 'urgent' ? 'high' : 'medium',
    action: {
      suggested_action: suggestedAction,
      requires_human_approval: highRisk || needsReply,
      tenant_id: tenant?.id || null,
      issue_id: issueId || null
    }
  };
}

function buildReplyDraft({ fromName, subject, classification, tenant, issue }) {
  const greetingName = firstName(fromName || tenant?.name);
  const greeting = greetingName ? `Hi ${greetingName},` : 'Hi,';
  const safeSubject = subject ? subject.replace(/^re:\s*/i, '') : 'your email';
  const issueLine = issue
    ? `We have logged this on FFR Property OS as issue ${issue.uuid || issue.id}: ${issue.title || safeSubject}.`
    : 'I have picked this up and logged it for the team to review.';

  const domainLines = {
    maintenance: 'The team will review the details and come back with the next step or any access questions.',
    finance: 'We will check the account records before confirming anything financial.',
    compliance: 'We will check the relevant property records and come back once the evidence has been reviewed.',
    leasing: 'We will review the tenancy/leasing details and come back with the right next step.',
    utilities: 'We will check the meter, supplier and billing records before confirming the position.',
    contractors: 'We will check this against the job record and contractor notes.',
    short_lets: 'We will check the booking and operational calendar before confirming.',
    operations: 'We will review and come back shortly.'
  };

  const urgencyLine = classification.priority === 'urgent'
    ? '\n\nIf this is an immediate safety issue, please call the emergency contact route as well as replying here.'
    : '';

  return `${greeting}

Thanks for your email about ${safeSubject}.

${issueLine} ${domainLines[classification.domain] || domainLines.operations}${urgencyLine}

Best,
52 Old Elvet Team`;
}

function recordEvent(db, eventType, domain, sourceRef, payload = {}) {
  db.prepare(`
    INSERT INTO agent_events (event_type, domain, source, source_ref, actor, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventType, domain, 'email_agent', sourceRef || null, 'admin_email_agent', JSON.stringify(payload));
}

async function recordEmailItem({ accountId, messageId, gmailThreadId, fromEmail, fromName, subject, body, matchedTenantId, issueId, status }) {
  const db = getDb();
  try {
    const existing = db.prepare('SELECT id FROM email_agent_items WHERE message_id = ?').get(messageId);
    if (existing) return { skipped: true, id: existing.id };

    const account = db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(accountId);
    const tenant = matchedTenantId
      ? db.prepare('SELECT t.*, p.name as property_name FROM tenants t LEFT JOIN properties p ON t.property_id = p.id WHERE t.id = ?').get(matchedTenantId)
      : null;
    const issue = issueId ? db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId) : null;
    const log = db.prepare('SELECT id FROM email_sync_log WHERE message_id = ?').get(messageId);
    const classification = classifyEmail({ subject, body, fromEmail, fromName, tenant, issueId });

    const itemId = db.prepare(`
      INSERT INTO email_agent_items (
        email_account_id, email_sync_log_id, message_id, from_address, from_name, subject, body_preview,
        matched_tenant_id, issue_id, domain, priority, status, needs_reply, needs_team_followup,
        suggested_owner, summary, action_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId,
      log?.id || null,
      messageId,
      fromEmail || null,
      fromName || null,
      subject || null,
      truncate(body, 1600),
      matchedTenantId || null,
      issueId || null,
      classification.domain,
      classification.priority,
      status || 'processed',
      classification.needs_reply,
      classification.needs_team_followup,
      classification.suggested_owner,
      classification.summary,
      JSON.stringify(classification.action)
    ).lastInsertRowid;

    let draftId = null;
    let gmailDraftId = null;
    let gmailDraftStatus = null;
    if (classification.needs_reply && fromEmail && !isNoReplyAddress(fromEmail) && isManagedInboxAccount(account)) {
      const draftBody = buildReplyDraft({ fromName, subject, classification, tenant, issue });
      draftId = db.prepare(`
        INSERT INTO email_agent_drafts (email_agent_item_id, email_account_id, message_id, gmail_thread_id, to_address, subject, body_text, gmail_draft_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(itemId, accountId, messageId, gmailThreadId || null, fromEmail, subject ? `Re: ${subject.replace(/^re:\s*/i, '')}` : 'Re: Your email', draftBody, 'pending').lastInsertRowid;

      if (account?.provider === 'gmail') {
        try {
          const gmailDraft = await createGmailDraft(account, {
            to: fromEmail,
            subject: subject ? `Re: ${subject.replace(/^re:\s*/i, '')}` : 'Re: Your email',
            bodyText: draftBody,
            threadId: gmailThreadId
          });
          gmailDraftId = gmailDraft?.id || null;
          gmailDraftStatus = gmailDraftId ? 'created' : 'not_created';
          db.prepare(`
            UPDATE email_agent_drafts
            SET gmail_draft_id = ?, gmail_draft_status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(gmailDraftId, gmailDraftStatus, draftId);
        } catch (error) {
          gmailDraftStatus = 'failed';
          const message = /insufficient|forbidden|scope|permission/i.test(error.message || '')
            ? 'Gmail draft creation failed. Reconnect the Gmail account in Settings so it grants Gmail compose permission.'
            : error.message;
          db.prepare(`
            UPDATE email_agent_drafts
            SET gmail_draft_status = ?, error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(gmailDraftStatus, message, draftId);
          console.error('[EmailAgent] Gmail draft creation failed:', message);
        }
      } else {
        db.prepare(`
          UPDATE email_agent_drafts
          SET gmail_draft_status = ?, error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run('not_gmail', 'Connect admin@52oldelvet.com with Gmail OAuth to create real Gmail drafts.', draftId);
      }

      db.prepare(`
        INSERT INTO agent_approvals (action_type, title, summary, payload_json, risk_level, requested_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'send_email_reply',
        `Review reply draft: ${subject || fromEmail}`,
        gmailDraftId
          ? `Gmail Draft created for ${fromEmail} by Admin Email Agent.`
          : `Reply draft to ${fromEmail} created by Admin Email Agent.`,
        JSON.stringify({ draft_id: draftId, gmail_draft_id: gmailDraftId, email_agent_item_id: itemId, to: fromEmail, subject }),
        classification.risk_level,
        'admin_email_agent'
      );
    }

    if (classification.needs_team_followup) {
      const taskId = db.prepare(`
        INSERT INTO agent_tasks (title, description, domain, tenant_id, issue_id, priority, source, source_ref, assigned_to, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `Email follow-up: ${subject || fromEmail || 'No subject'}`.slice(0, 140),
        `${classification.summary}\n\nSuggested action: ${classification.action.suggested_action}\n\nPreview: ${truncate(body, 700)}`,
        classification.domain,
        matchedTenantId || null,
        issueId || null,
        classification.priority,
        'email_agent',
        messageId,
        classification.suggested_owner,
        'admin_email_agent'
      ).lastInsertRowid;

      recordEvent(db, 'email_task_created', classification.domain, messageId, { task_id: taskId, draft_id: draftId });
    } else {
      recordEvent(db, 'email_item_processed', classification.domain, messageId, { draft_id: draftId });
    }

    return { id: itemId, draft_id: draftId, gmail_draft_id: gmailDraftId, gmail_draft_status: gmailDraftStatus, classification, account: account?.email_address || null };
  } finally {
    db.close();
  }
}

function getSummary() {
  const db = getDb();
  try {
    const adminAccount = db.prepare(`
      SELECT id, provider, email_address, last_sync_at, sync_enabled
      FROM email_accounts
      WHERE LOWER(email_address) = LOWER(?)
      ORDER BY id DESC
      LIMIT 1
    `).get(process.env.EMAIL_AGENT_INBOX || 'admin@52oldelvet.com');

    const totals = db.prepare(`
      SELECT
        COUNT(*) as items,
        COALESCE(SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END), 0) as today,
        COALESCE(SUM(CASE WHEN needs_reply = 1 THEN 1 ELSE 0 END), 0) as needs_reply,
        COALESCE(SUM(CASE WHEN needs_team_followup = 1 THEN 1 ELSE 0 END), 0) as needs_followup
      FROM email_agent_items
    `).get();

    const drafts = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM email_agent_drafts
      GROUP BY status
    `).all();

    const domains = db.prepare(`
      SELECT domain, COUNT(*) as count
      FROM email_agent_items
      GROUP BY domain
      ORDER BY count DESC
    `).all();

    const latestReport = db.prepare('SELECT * FROM email_agent_reports ORDER BY report_date DESC LIMIT 1').get();
    return { admin_account: adminAccount || null, totals, drafts, domains, team_recipients: getTeamRecipients(), latest_report: latestReport || null };
  } finally {
    db.close();
  }
}

function getItems(limit = 100) {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT ei.*, ea.email_address as account_email, t.name as tenant_name, i.uuid as issue_uuid, i.title as issue_title
      FROM email_agent_items ei
      LEFT JOIN email_accounts ea ON ei.email_account_id = ea.id
      LEFT JOIN tenants t ON ei.matched_tenant_id = t.id
      LEFT JOIN issues i ON ei.issue_id = i.id
      ORDER BY ei.created_at DESC
      LIMIT ?
    `).all(Number(limit) || 100);
  } finally {
    db.close();
  }
}

function getDrafts(status = 'draft', limit = 100) {
  const db = getDb();
  try {
    const params = [];
    let where = '';
    if (status && status !== 'all') {
      where = 'WHERE d.status = ?';
      params.push(status);
    }
    params.push(Number(limit) || 100);
    return db.prepare(`
      SELECT d.*, ei.domain, ei.priority, ei.summary, ei.suggested_owner, ea.email_address as account_email
      FROM email_agent_drafts d
      LEFT JOIN email_agent_items ei ON d.email_agent_item_id = ei.id
      LEFT JOIN email_accounts ea ON d.email_account_id = ea.id
      ${where}
      ORDER BY d.created_at DESC
      LIMIT ?
    `).all(...params);
  } finally {
    db.close();
  }
}

function updateDraft(id, { subject, body_text, status }, actor = 'user') {
  const db = getDb();
  try {
    const draft = db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
    if (!draft) throw new Error('Draft not found');
    db.prepare(`
      UPDATE email_agent_drafts
      SET subject = ?, body_text = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(subject || draft.subject, body_text || draft.body_text, status || draft.status, id);
    recordEvent(db, 'email_draft_updated', 'operations', String(id), { actor });
    return db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
  } finally {
    db.close();
  }
}

function approveDraft(id, actor = 'user') {
  const db = getDb();
  try {
    const draft = db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
    if (!draft) throw new Error('Draft not found');
    db.prepare(`
      UPDATE email_agent_drafts
      SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(actor, id);
    recordEvent(db, 'email_draft_approved', 'operations', String(id), { actor });
    return db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
  } finally {
    db.close();
  }
}

async function sendDraft(id, actor = 'user') {
  const db = getDb();
  let draft;
  try {
    draft = db.prepare('SELECT * FROM email_agent_drafts WHERE id = ?').get(id);
  } finally {
    db.close();
  }
  if (!draft) throw new Error('Draft not found');
  if (draft.status !== 'approved') throw new Error('Draft must be approved before sending');

  try {
    await sendGenericEmail({
      to: draft.to_address,
      subject: draft.subject,
      text: draft.body_text,
      fromName: '52 Old Elvet'
    });

    const db2 = getDb();
    try {
      db2.prepare(`
        UPDATE email_agent_drafts
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, error = NULL
        WHERE id = ?
      `).run(id);
      recordEvent(db2, 'email_draft_sent', 'operations', String(id), { actor, to: draft.to_address });
    } finally {
      db2.close();
    }
    return { success: true };
  } catch (error) {
    const db3 = getDb();
    try {
      db3.prepare('UPDATE email_agent_drafts SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(error.message, id);
    } finally {
      db3.close();
    }
    throw error;
  }
}

function buildDailyReport(date = todayKey()) {
  const db = getDb();
  try {
    const items = db.prepare(`
      SELECT ei.*, t.name as tenant_name, i.uuid as issue_uuid, i.title as issue_title
      FROM email_agent_items ei
      LEFT JOIN tenants t ON ei.matched_tenant_id = t.id
      LEFT JOIN issues i ON ei.issue_id = i.id
      WHERE DATE(ei.created_at) = DATE(?)
      ORDER BY
        CASE ei.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        ei.created_at DESC
    `).all(date);

    const tasks = db.prepare(`
      SELECT *
      FROM agent_tasks
      WHERE source = 'email_agent' AND status = 'open'
      ORDER BY
        CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT 20
    `).all();

    const drafts = db.prepare(`
      SELECT d.*, ei.domain, ei.priority
      FROM email_agent_drafts d
      LEFT JOIN email_agent_items ei ON d.email_agent_item_id = ei.id
      WHERE DATE(d.created_at) = DATE(?) AND d.status IN ('draft', 'approved')
      ORDER BY d.created_at DESC
    `).all(date);

    const domainCounts = items.reduce((acc, item) => {
      acc[item.domain] = (acc[item.domain] || 0) + 1;
      return acc;
    }, {});

    const subject = `FFR Property OS email brief - ${date}`;
    const lines = [
      `FFR Property OS email brief - ${date}`,
      '',
      `Inbox handled: ${items.length}`,
      `Reply drafts waiting: ${drafts.length}`,
      `Open team follow-ups: ${tasks.length}`,
      '',
      'Domain mix:',
      ...Object.entries(domainCounts).map(([domain, count]) => `- ${domain.replace(/_/g, ' ')}: ${count}`),
      '',
      'Important email items:',
      ...(items.slice(0, 12).map(item => `- [${item.priority}] ${item.summary}${item.issue_uuid ? ` (issue ${item.issue_uuid})` : ''}`)),
      ...(items.length === 0 ? ['- No new email items were processed by the agent today.'] : []),
      '',
      'Team reminders:',
      ...(tasks.slice(0, 12).map(task => `- ${task.assigned_to || 'Unassigned'}: ${task.title} (${task.priority})`)),
      ...(tasks.length === 0 ? ['- No open email-agent reminders.'] : []),
      '',
      'Drafts for approval:',
      ...(drafts.slice(0, 10).map(draft => `- ${draft.to_address}: ${draft.subject} (${draft.status})`)),
      ...(drafts.length === 0 ? ['- No reply drafts waiting.'] : []),
      '',
      'This report is generated from connected admin inbox sync, FFR Property OS tasks, and agent approvals.'
    ];

    const bodyText = lines.join('\n');
    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; color: #172033;">
        <h2 style="margin-bottom: 4px;">FFR Property OS email brief</h2>
        <p style="color: #64748b; margin-top: 0;">${date}</p>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 18px 0;">
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;"><strong>${items.length}</strong><br><span style="color:#64748b;">Emails handled</span></div>
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;"><strong>${drafts.length}</strong><br><span style="color:#64748b;">Drafts waiting</span></div>
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;"><strong>${tasks.length}</strong><br><span style="color:#64748b;">Team reminders</span></div>
        </div>
        <h3>Important email items</h3>
        <ul>${(items.slice(0, 12).map(item => `<li><strong>${item.priority}</strong> - ${item.summary}${item.issue_uuid ? ` (issue ${item.issue_uuid})` : ''}</li>`).join('') || '<li>No new email items were processed by the agent today.</li>')}</ul>
        <h3>Team reminders</h3>
        <ul>${(tasks.slice(0, 12).map(task => `<li>${task.assigned_to || 'Unassigned'}: ${task.title} (${task.priority})</li>`).join('') || '<li>No open email-agent reminders.</li>')}</ul>
        <h3>Drafts for approval</h3>
        <ul>${(drafts.slice(0, 10).map(draft => `<li>${draft.to_address}: ${draft.subject} (${draft.status})</li>`).join('') || '<li>No reply drafts waiting.</li>')}</ul>
      </div>`;

    const recipients = getTeamRecipients();
    const existing = db.prepare('SELECT id FROM email_agent_reports WHERE report_date = ?').get(date);
    if (existing) {
      db.prepare(`
        UPDATE email_agent_reports
        SET subject = ?, body_text = ?, body_html = ?, recipients_json = ?, status = CASE WHEN status = 'sent' THEN status ELSE 'draft' END, updated_at = CURRENT_TIMESTAMP
        WHERE report_date = ?
      `).run(subject, bodyText, bodyHtml, JSON.stringify(recipients), date);
    } else {
      db.prepare(`
        INSERT INTO email_agent_reports (report_date, subject, body_text, body_html, recipients_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(date, subject, bodyText, bodyHtml, JSON.stringify(recipients));
    }

    return db.prepare('SELECT * FROM email_agent_reports WHERE report_date = ?').get(date);
  } finally {
    db.close();
  }
}

async function sendDailyReport(date = todayKey(), actor = 'admin_email_agent') {
  let report = buildDailyReport(date);
  if (report.status === 'sent') return { success: true, already_sent: true, report };

  const recipients = JSON.parse(report.recipients_json || '[]');
  try {
    await sendGenericEmail({
      to: recipients.join(','),
      subject: report.subject,
      text: report.body_text,
      html: report.body_html,
      fromName: 'FFR Property OS'
    });

    const db = getDb();
    try {
      db.prepare(`
        UPDATE email_agent_reports
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(report.id);
      recordEvent(db, 'email_daily_report_sent', 'operations', date, { actor, recipients });
      report = db.prepare('SELECT * FROM email_agent_reports WHERE id = ?').get(report.id);
    } finally {
      db.close();
    }
    return { success: true, report };
  } catch (error) {
    const db = getDb();
    try {
      db.prepare('UPDATE email_agent_reports SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('failed', error.message, report.id);
    } finally {
      db.close();
    }
    throw error;
  }
}

let reportInterval = null;

async function maybeSendScheduledReport() {
  if (process.env.EMAIL_AGENT_DAILY_REPORT_ENABLED === 'false') return;
  const summary = getSummary();
  if (!summary.admin_account && process.env.EMAIL_AGENT_SEND_EMPTY_REPORTS !== 'true') return;

  const { hour, minute } = getLocalTimeParts();
  const targetHour = Number(process.env.EMAIL_AGENT_REPORT_HOUR || 17);
  const targetMinute = Number(process.env.EMAIL_AGENT_REPORT_MINUTE || 30);
  if (hour < targetHour || (hour === targetHour && minute < targetMinute)) return;

  const date = todayKey();
  const db = getDb();
  try {
    const existing = db.prepare('SELECT status FROM email_agent_reports WHERE report_date = ?').get(date);
    if (existing?.status === 'sent') return;
  } finally {
    db.close();
  }

  try {
    await sendDailyReport(date, 'scheduler');
  } catch (error) {
    console.error('[EmailAgent] Scheduled report failed:', error.message);
  }
}

function startEmailAgentScheduler() {
  if (reportInterval) return;
  reportInterval = setInterval(maybeSendScheduledReport, 15 * 60 * 1000);
  setTimeout(maybeSendScheduledReport, 60 * 1000);
  console.log('[EmailAgent] Daily report scheduler started');
}

function stopEmailAgentScheduler() {
  if (reportInterval) {
    clearInterval(reportInterval);
    reportInterval = null;
  }
}

module.exports = {
  DEFAULT_TEAM_RECIPIENTS,
  getTeamRecipients,
  todayKey,
  classifyEmail,
  recordEmailItem,
  getSummary,
  getItems,
  getDrafts,
  updateDraft,
  approveDraft,
  sendDraft,
  buildDailyReport,
  sendDailyReport,
  startEmailAgentScheduler,
  stopEmailAgentScheduler
};
