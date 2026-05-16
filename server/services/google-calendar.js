const { getDb } = require('../database');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

let google = null;
try {
  google = require('googleapis').google;
} catch {
  console.log('[Calendar] googleapis not installed - Google Calendar sync disabled');
}

const DEFAULT_REDIRECT_URI = 'https://maintenance.52oldelvet.com/api/calendar/google/callback';
const DEFAULT_CALENDAR_ID = process.env.GOOGLE_SHARED_CALENDAR_ID || 'primary';

function getOAuthClient() {
  if (!google) throw new Error('googleapis package not installed. Run: npm install googleapis');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required.');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function normaliseOwner(user = {}) {
  return {
    id: user.id || user.staff_id || null,
    email: user.email || null,
    name: user.name || user.email || null,
    role: user.role || null
  };
}

function getRequestedCalendarId(calendarId) {
  return String(calendarId || process.env.GOOGLE_SHARED_CALENDAR_ID || DEFAULT_CALENDAR_ID || 'primary').trim() || 'primary';
}

function getGoogleCalendarAuthUrl(user = {}, options = {}) {
  const oauth2Client = getOAuthClient();
  const owner = normaliseOwner(user);
  const calendarId = getRequestedCalendarId(options.calendar_id);
  const state = jwt.sign(
    { purpose: 'google_calendar_oauth', calendar_id: calendarId, ...owner },
    JWT_SECRET,
    { expiresIn: '20m' }
  );
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state,
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ]
  });
}

async function handleGoogleCalendarCallback(code, ownerPayload = {}) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  let email = 'unknown@google-calendar';
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const profile = await oauth2.userinfo.get();
    email = profile.data.email || email;
  } catch (error) {
    console.warn('[Calendar] Could not fetch profile email:', error.message);
  }

  const owner = normaliseOwner(ownerPayload);
  const calendarId = getRequestedCalendarId(ownerPayload.calendar_id);
  let calendarName = calendarId === 'primary' ? 'Primary calendar' : calendarId;
  try {
    const calendarApi = google.calendar({ version: 'v3', auth: oauth2Client });
    const cal = await calendarApi.calendars.get({ calendarId });
    calendarName = cal.data.summary || calendarName;
  } catch (error) {
    console.warn(`[Calendar] Could not fetch calendar metadata for ${calendarId}:`, error.message);
  }

  const db = getDb();
  try {
    const existing = db.prepare(`
      SELECT id FROM calendar_accounts
      WHERE provider = ? AND LOWER(email_address) = LOWER(?) AND calendar_id = ?
    `).get('google', email, calendarId);

    let id;
    if (existing) {
      const current = db.prepare('SELECT credentials FROM calendar_accounts WHERE id = ?').get(existing.id);
      const currentCredentials = current?.credentials ? JSON.parse(current.credentials) : {};
      const nextCredentials = { ...currentCredentials, ...tokens, refresh_token: tokens.refresh_token || currentCredentials.refresh_token };
      db.prepare(`
        UPDATE calendar_accounts
        SET credentials = ?,
            sync_enabled = 1,
            calendar_name = ?,
            connected_by_staff_id = ?,
            connected_by_email = ?,
            connected_by_name = ?,
            sync_window_days = COALESCE(sync_window_days, 30)
        WHERE id = ?
      `).run(JSON.stringify(nextCredentials), calendarName, owner.id, owner.email, owner.name, existing.id);
      id = existing.id;
    } else {
      id = db.prepare(`
        INSERT INTO calendar_accounts (
          provider, email_address, calendar_id, calendar_name, credentials, sync_enabled,
          connected_by_staff_id, connected_by_email, connected_by_name, sync_window_days
        )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 30)
      `).run('google', email, calendarId, calendarName, JSON.stringify(tokens), owner.id, owner.email, owner.name).lastInsertRowid;
    }

    const account = db.prepare('SELECT id, provider, email_address, calendar_id, calendar_name, last_sync_at, sync_enabled FROM calendar_accounts WHERE id = ?').get(id);
    return { ...account, provider: 'google' };
  } finally {
    db.close();
  }
}

function parseCredentials(account) {
  try { return JSON.parse(account.credentials || '{}'); } catch { return {}; }
}

function eventDateTime(value) {
  if (!value) return null;
  return value.dateTime || (value.date ? `${value.date}T00:00:00` : null);
}

async function syncGoogleCalendarAccount(account, options = {}) {
  if (!google) return { synced: 0, error: 'googleapis not installed' };

  const oauth2Client = getOAuthClient();
  const tokens = parseCredentials(account);
  oauth2Client.setCredentials(tokens);
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const nextCredentials = { ...tokens, ...credentials, refresh_token: credentials.refresh_token || tokens.refresh_token };
    oauth2Client.setCredentials(nextCredentials);
    const db = getDb();
    try {
      db.prepare('UPDATE calendar_accounts SET credentials = ? WHERE id = ?').run(JSON.stringify(nextCredentials), account.id);
    } finally {
      db.close();
    }
  }
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const days = Math.min(Number(options.days || account.sync_window_days || 30), 180);
  const timeMin = new Date();
  const timeMax = new Date(Date.now() + days * 86400000);

  const response = await calendar.events.list({
    calendarId: account.calendar_id || DEFAULT_CALENDAR_ID,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: 100,
    singleEvents: true,
    orderBy: 'startTime'
  });

  const events = response.data.items || [];
  const db = getDb();
  try {
    const insert = db.prepare(`
      INSERT INTO calendar_events (
        calendar_account_id, google_event_id, calendar_id, summary, description, location,
        start_at, end_at, html_link, status, raw_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(calendar_account_id, google_event_id) DO UPDATE SET
        calendar_id = excluded.calendar_id,
        summary = excluded.summary,
        description = excluded.description,
        location = excluded.location,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        html_link = excluded.html_link,
        status = excluded.status,
        raw_json = excluded.raw_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const event of events) {
      insert.run(
        account.id,
        event.id,
        account.calendar_id || DEFAULT_CALENDAR_ID,
        event.summary || '(No title)',
        event.description || null,
        event.location || null,
        eventDateTime(event.start),
        eventDateTime(event.end),
        event.htmlLink || null,
        event.status || null,
        JSON.stringify(event)
      );
    }

    db.prepare('UPDATE calendar_accounts SET last_sync_at = CURRENT_TIMESTAMP, last_context_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_context_at END WHERE id = ?').run(events.length, account.id);
  } finally {
    db.close();
  }

  return { synced: events.length, calendar_id: account.calendar_id || DEFAULT_CALENDAR_ID };
}

async function syncAllCalendars(options = {}) {
  const db = getDb();
  let accounts;
  try {
    accounts = db.prepare('SELECT * FROM calendar_accounts WHERE sync_enabled = 1 ORDER BY created_at DESC').all();
  } finally {
    db.close();
  }

  const results = [];
  for (const account of accounts) {
    try {
      results.push({ account_id: account.id, email_address: account.email_address, ...(await syncGoogleCalendarAccount(account, options)) });
    } catch (error) {
      results.push({ account_id: account.id, email_address: account.email_address, error: error.message });
    }
  }
  return { accounts: accounts.length, results };
}

function listCalendarAccounts() {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT id, provider, email_address, calendar_id, last_sync_at, sync_enabled, created_at
      , calendar_name, connected_by_email, connected_by_name, sync_window_days, last_context_at
      FROM calendar_accounts
      ORDER BY created_at DESC
    `).all();
  } finally {
    db.close();
  }
}

function listUpcomingEvents(limit = 25) {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT ce.*, ca.email_address as account_email
      FROM calendar_events ce
      LEFT JOIN calendar_accounts ca ON ca.id = ce.calendar_account_id
      WHERE ce.start_at IS NULL OR ce.start_at >= datetime('now', '-2 hours')
      ORDER BY COALESCE(ce.start_at, ce.updated_at) ASC
      LIMIT ?
    `).all(Math.min(Number(limit) || 25, 100));
  } finally {
    db.close();
  }
}

module.exports = {
  getGoogleCalendarAuthUrl,
  handleGoogleCalendarCallback,
  syncGoogleCalendarAccount,
  syncAllCalendars,
  listCalendarAccounts,
  listUpcomingEvents
};
