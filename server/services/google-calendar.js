const { getDb } = require('../database');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { hashObject, recordBusinessEvent } = require('./business-ledger');

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
            sync_window_days = COALESCE(sync_window_days, 180),
            sync_past_days = COALESCE(sync_past_days, 365)
        WHERE id = ?
      `).run(JSON.stringify(nextCredentials), calendarName, owner.id, owner.email, owner.name, existing.id);
      id = existing.id;
    } else {
      id = db.prepare(`
        INSERT INTO calendar_accounts (
          provider, email_address, calendar_id, calendar_name, credentials, sync_enabled,
          connected_by_staff_id, connected_by_email, connected_by_name, sync_window_days, sync_past_days
        )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 180, 365)
      `).run('google', email, calendarId, calendarName, JSON.stringify(tokens), owner.id, owner.email, owner.name).lastInsertRowid;
    }

    recordBusinessEvent(db, {
      event_type: existing ? 'calendar_account_reconnected' : 'calendar_account_connected',
      domain: 'operations',
      importance: 'high',
      source_system: 'google_calendar',
      source_table: 'calendar_accounts',
      source_id: id,
      external_id: calendarId,
      actor: owner.email || email || 'google_calendar',
      summary: `${calendarName} connected for ${email}`,
      payload: {
        provider: 'google',
        email_address: email,
        calendar_id: calendarId,
        calendar_name: calendarName,
        connected_by_email: owner.email,
        connected_by_name: owner.name
      }
    });

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

function boundedDays(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function calendarEventSnapshot(account, event) {
  const startAt = eventDateTime(event.start);
  const endAt = eventDateTime(event.end);
  const payload = {
    calendar_account_id: account.id,
    google_event_id: event.id,
    calendar_id: account.calendar_id || DEFAULT_CALENDAR_ID,
    summary: event.summary || '(No title)',
    description: event.description || null,
    location: event.location || null,
    start_at: startAt,
    end_at: endAt,
    html_link: event.htmlLink || null,
    status: event.status || null,
    google_updated: event.updated || null,
    creator: event.creator || null,
    organizer: event.organizer || null,
    event_type: event.eventType || null
  };
  return {
    ...payload,
    raw_json: JSON.stringify(event),
    content_hash: hashObject(payload)
  };
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
      recordBusinessEvent(db, {
        event_type: 'calendar_credentials_refreshed',
        domain: 'operations',
        source_system: 'google_calendar',
        source_table: 'calendar_accounts',
        source_id: account.id,
        external_id: account.calendar_id || DEFAULT_CALENDAR_ID,
        actor: account.connected_by_email || account.email_address || 'system',
        summary: `Calendar credentials refreshed for ${account.calendar_name || account.calendar_id || account.email_address}`,
        payload: { calendar_id: account.calendar_id || DEFAULT_CALENDAR_ID, account_email: account.email_address }
      });
    } finally {
      db.close();
    }
  }
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const days = boundedDays(options.days || account.sync_window_days || process.env.GOOGLE_CALENDAR_FUTURE_DAYS, 180, 730);
  const pastDays = boundedDays(options.past_days || account.sync_past_days || process.env.GOOGLE_CALENDAR_PAST_DAYS, 365, 1825);
  const timeMin = new Date(Date.now() - pastDays * 86400000);
  const timeMax = new Date(Date.now() + days * 86400000);

  const dbStart = getDb();
  const syncStartedAt = new Date().toISOString();
  try {
    recordBusinessEvent(dbStart, {
      event_type: 'calendar_sync_started',
      domain: 'operations',
      source_system: 'google_calendar',
      source_table: 'calendar_accounts',
      source_id: account.id,
      external_id: account.calendar_id || DEFAULT_CALENDAR_ID,
      actor: account.connected_by_email || account.email_address || 'system',
      happened_at: syncStartedAt,
      summary: `Started calendar sync for ${account.calendar_name || account.calendar_id || account.email_address}`,
      payload: { calendar_id: account.calendar_id || DEFAULT_CALENDAR_ID, time_min: timeMin.toISOString(), time_max: timeMax.toISOString(), past_days: pastDays, future_days: days }
    });
  } finally {
    dbStart.close();
  }

  const events = [];
  let pageToken = null;
  do {
    const response = await calendar.events.list({
      calendarId: account.calendar_id || DEFAULT_CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 2500,
      singleEvents: true,
      showDeleted: true,
      pageToken
    });
    events.push(...(response.data.items || []));
    pageToken = response.data.nextPageToken || null;
  } while (pageToken);

  const db = getDb();
  const stats = { new: 0, changed: 0, cancelled: 0, unchanged: 0 };
  try {
    const insert = db.prepare(`
      INSERT INTO calendar_events (
        calendar_account_id, google_event_id, calendar_id, summary, description, location,
        start_at, end_at, html_link, status, raw_json, content_hash, first_seen_at, last_seen_at, cancelled_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CASE WHEN ? = 'cancelled' THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
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
        content_hash = excluded.content_hash,
        last_seen_at = CURRENT_TIMESTAMP,
        cancelled_at = CASE WHEN excluded.status = 'cancelled' THEN COALESCE(calendar_events.cancelled_at, CURRENT_TIMESTAMP) ELSE calendar_events.cancelled_at END,
        updated_at = CURRENT_TIMESTAMP
    `);
    const versionInsert = db.prepare(`
      INSERT INTO calendar_event_versions (
        calendar_account_id, calendar_event_id, google_event_id, calendar_id, event_hash, summary, description,
        location, start_at, end_at, html_link, status, raw_json, first_seen_at, last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(calendar_account_id, google_event_id, event_hash) DO UPDATE SET
        calendar_event_id = COALESCE(excluded.calendar_event_id, calendar_event_versions.calendar_event_id),
        last_seen_at = CURRENT_TIMESTAMP
    `);

    for (const event of events) {
      const snapshot = calendarEventSnapshot(account, event);
      const previous = db.prepare('SELECT id, content_hash, status, cancelled_at FROM calendar_events WHERE calendar_account_id = ? AND google_event_id = ?').get(account.id, snapshot.google_event_id);
      insert.run(
        account.id,
        snapshot.google_event_id,
        snapshot.calendar_id,
        snapshot.summary,
        snapshot.description,
        snapshot.location,
        snapshot.start_at,
        snapshot.end_at,
        snapshot.html_link,
        snapshot.status,
        snapshot.raw_json,
        snapshot.content_hash,
        snapshot.status
      );
      const current = db.prepare('SELECT id FROM calendar_events WHERE calendar_account_id = ? AND google_event_id = ?').get(account.id, snapshot.google_event_id);
      versionInsert.run(
        account.id,
        current?.id || previous?.id || null,
        snapshot.google_event_id,
        snapshot.calendar_id,
        snapshot.content_hash,
        snapshot.summary,
        snapshot.description,
        snapshot.location,
        snapshot.start_at,
        snapshot.end_at,
        snapshot.html_link,
        snapshot.status,
        snapshot.raw_json
      );

      const isCancelled = snapshot.status === 'cancelled';
      const eventType = !previous
        ? 'calendar_event_created'
        : isCancelled && previous.status !== 'cancelled'
        ? 'calendar_event_cancelled'
        : previous.content_hash !== snapshot.content_hash
        ? 'calendar_event_updated'
        : null;
      if (!previous) stats.new += 1;
      else if (eventType === 'calendar_event_cancelled') stats.cancelled += 1;
      else if (eventType === 'calendar_event_updated') stats.changed += 1;
      else stats.unchanged += 1;

      if (eventType) {
        recordBusinessEvent(db, {
          event_uid: `google-calendar:${account.id}:${snapshot.google_event_id}:${snapshot.content_hash}`,
          event_type: eventType,
          domain: 'operations',
          importance: isCancelled ? 'high' : 'normal',
          source_system: 'google_calendar',
          source_table: 'calendar_events',
          source_id: current?.id || previous?.id || null,
          external_id: snapshot.google_event_id,
          actor: account.connected_by_email || account.email_address || 'google_calendar',
          happened_at: snapshot.start_at || event.updated || syncStartedAt,
          summary: `${snapshot.summary} (${snapshot.status || 'confirmed'})`,
          payload: {
            calendar_account_id: account.id,
            calendar_id: snapshot.calendar_id,
            calendar_name: account.calendar_name,
            account_email: account.email_address,
            start_at: snapshot.start_at,
            end_at: snapshot.end_at,
            location: snapshot.location,
            status: snapshot.status,
            html_link: snapshot.html_link,
            version_hash: snapshot.content_hash
          },
          raw: event,
          content_hash: snapshot.content_hash
        });
      }
    }

    db.prepare('UPDATE calendar_accounts SET last_sync_at = CURRENT_TIMESTAMP, last_context_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_context_at END WHERE id = ?').run(events.length, account.id);
    recordBusinessEvent(db, {
      event_type: 'calendar_sync_completed',
      domain: 'operations',
      source_system: 'google_calendar',
      source_table: 'calendar_accounts',
      source_id: account.id,
      external_id: account.calendar_id || DEFAULT_CALENDAR_ID,
      actor: account.connected_by_email || account.email_address || 'system',
      summary: `Completed calendar sync for ${account.calendar_name || account.calendar_id || account.email_address}: ${events.length} events observed`,
      payload: { calendar_id: account.calendar_id || DEFAULT_CALENDAR_ID, observed: events.length, ...stats, time_min: timeMin.toISOString(), time_max: timeMax.toISOString() }
    });
  } finally {
    db.close();
  }

  return { synced: events.length, calendar_id: account.calendar_id || DEFAULT_CALENDAR_ID, ...stats };
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
      , calendar_name, connected_by_email, connected_by_name, sync_window_days, sync_past_days, last_context_at
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
