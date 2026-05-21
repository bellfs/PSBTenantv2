const axios = require('axios');
const { getDb } = require('../database');
const {
  actorFromUser,
  hashObject,
  recordBusinessEvent,
  stableStringify
} = require('./business-ledger');

const GUESTY_AUTH_URL = 'https://open-api.guesty.com/oauth2/token';
const GUESTY_API_BASE = 'https://open-api.guesty.com/v1';
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

const DEFAULT_WEBHOOK_EVENTS = [
  'reservation.created.v2',
  'reservation.updated.v2',
  'reservation.new',
  'reservation.updated',
  'reservation.messageReceived',
  'reservation.messageSent',
  'listing.updated',
  'listing.calendar.updated',
  'calendar.updated.v2',
  'payments.failed',
  'payments.method.received',
  'task.created',
  'task.updated',
  'task.deleted'
];

const ACTIVE_RESERVATION_STATUSES = new Set([
  'confirmed',
  'reserved',
  'checked_in',
  'checked-in',
  'checked_out',
  'checked-out',
  'completed'
]);

const INACTIVE_RESERVATION_RE = /(cancel|canceled|cancelled|declined|expired|rejected|closed|lost)/i;

const SHORT_LET_MATCHERS = [
  { property: '52 Old Elvet', patterns: [/52\s+old\s+elvet/i, /\bold\s+elvet\b/i, /\b52oe\b/i] },
  { property: '2 St Margarets Mews', patterns: [/2\s+st\.?\s*margarets?/i, /st\.?\s*margarets?\s+mews/i] },
  { property: '35 St Andrews Court', patterns: [/35\s+st\.?\s*andrews?/i, /st\.?\s*andrews?\s+court/i] },
  { property: '7 Cathedrals', patterns: [/7\s+cathedrals?/i, /\bcathedrals?\b/i] }
];

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const a = new Date(`${dateOnly(start)}T00:00:00.000Z`);
  const b = new Date(`${dateOnly(end)}T00:00:00.000Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function safeJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function asNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof value === 'object') {
    if (value.amount != null) return asNumber(value.amount, fallback);
    if (value.value != null) return asNumber(value.value, fallback);
    if (value.original != null) return asNumber(value.original, fallback);
    if (value.minorUnits != null) return asNumber(value.minorUnits, fallback) / 100;
  }
  return fallback;
}

function firstValue(object, paths, fallback = null) {
  for (const path of paths) {
    const parts = path.split('.');
    let value = object;
    for (const part of parts) {
      if (value == null) break;
      value = value[part];
    }
    if (value != null && value !== '') return value;
  }
  return fallback;
}

function compactText(...values) {
  return values.filter(Boolean).map(value => String(value)).join(' ').replace(/\s+/g, ' ').trim();
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.reservations)) return payload.reservations;
  return [];
}

function addressToString(address) {
  if (!address) return '';
  if (typeof address === 'string') return address;
  return compactText(address.full, address.street, address.line1, address.city, address.state, address.country, address.zipcode, address.postcode);
}

function redactAccount(account) {
  if (!account) return account;
  return {
    ...account,
    client_secret: account.client_secret ? '[configured]' : '',
    access_token: account.access_token ? '[cached]' : '',
    webhook_secret: account.webhook_secret ? '[configured]' : ''
  };
}

function ensureEnvAccount(db) {
  const clientId = process.env.GUESTY_CLIENT_ID;
  const clientSecret = process.env.GUESTY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const existing = db.prepare('SELECT * FROM guesty_accounts WHERE client_id = ? OR account_name = ? ORDER BY id LIMIT 1')
    .get(clientId, process.env.GUESTY_ACCOUNT_NAME || 'FFR Guesty');
  if (existing) {
    if (!existing.client_secret && clientSecret) {
      db.prepare('UPDATE guesty_accounts SET client_secret = ?, sync_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(clientSecret, existing.id);
      return db.prepare('SELECT * FROM guesty_accounts WHERE id = ?').get(existing.id);
    }
    return existing;
  }

  const id = db.prepare(`
    INSERT INTO guesty_accounts (account_name, client_id, client_secret, sync_enabled, connected_by_email, connected_by_name)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(
    process.env.GUESTY_ACCOUNT_NAME || 'FFR Guesty',
    clientId,
    clientSecret,
    process.env.ADMIN_EMAIL || 'admin@52oldelvet.com',
    'Environment'
  ).lastInsertRowid;

  recordBusinessEvent(db, {
    event_type: 'guesty_account_configured',
    domain: 'short_lets',
    importance: 'high',
    source_system: 'guesty',
    source_table: 'guesty_accounts',
    source_id: id,
    actor: 'system',
    summary: 'Guesty account configured from environment variables',
    payload: { account_name: process.env.GUESTY_ACCOUNT_NAME || 'FFR Guesty', client_id: '[configured]' }
  });

  return db.prepare('SELECT * FROM guesty_accounts WHERE id = ?').get(id);
}

function listAccounts(db = getDb()) {
  ensureEnvAccount(db);
  return db.prepare(`
    SELECT ga.*,
      (SELECT COUNT(*) FROM guesty_listings gl WHERE gl.guesty_account_id = ga.id) as listing_count,
      (SELECT COUNT(*) FROM guesty_reservations gr WHERE gr.guesty_account_id = ga.id) as reservation_count
    FROM guesty_accounts ga
    ORDER BY ga.sync_enabled DESC, ga.created_at DESC
  `).all().map(redactAccount);
}

function getAccount(db, id = null) {
  ensureEnvAccount(db);
  const account = id
    ? db.prepare('SELECT * FROM guesty_accounts WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM guesty_accounts WHERE sync_enabled = 1 ORDER BY id LIMIT 1').get();
  if (!account) throw new Error('Guesty account is not configured');
  if (!account.client_id || !account.client_secret) throw new Error('Guesty Client ID and Client Secret are required');
  return account;
}

async function getAccessToken(db, account) {
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && expiresAt - TOKEN_BUFFER_MS > Date.now()) return account.access_token;

  const response = await axios.post(GUESTY_AUTH_URL, {
    clientId: account.client_id,
    clientSecret: account.client_secret
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 });

  const token = response.data?.access_token;
  if (!token) throw new Error('Guesty did not return an access token');
  const expiresIn = Number(response.data?.expires_in || 3600);
  const tokenExpiresAt = new Date(Date.now() + Math.max(300, expiresIn - 60) * 1000).toISOString();
  db.prepare('UPDATE guesty_accounts SET access_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(token, tokenExpiresAt, account.id);
  return token;
}

async function guestyRequest(db, account, method, path, options = {}) {
  const token = await getAccessToken(db, account);
  const response = await axios({
    method,
    url: path.startsWith('http') ? path : `${GUESTY_API_BASE}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    params: options.params,
    data: options.body,
    timeout: options.timeout || 30000
  });
  return response.data;
}

function findPropertyId(db, record = {}) {
  const haystack = compactText(record.nickname, record.title, record.name, record.address, record.city, record.external_name);
  if (!haystack) return null;

  for (const matcher of SHORT_LET_MATCHERS) {
    if (matcher.patterns.some(pattern => pattern.test(haystack))) {
      const row = db.prepare('SELECT id FROM properties WHERE LOWER(name) = LOWER(?)').get(matcher.property);
      if (row) return row.id;
    }
  }

  const properties = db.prepare('SELECT id, name, address FROM properties').all();
  const lower = haystack.toLowerCase();
  const match = properties.find(property =>
    lower.includes(String(property.name || '').toLowerCase()) ||
    (property.address && lower.includes(String(property.address).toLowerCase().split(',')[0]))
  );
  return match?.id || null;
}

function normaliseListing(db, listing) {
  const listingId = String(listing._id || listing.id || listing.listingId || '');
  const address = addressToString(listing.address);
  const record = {
    guesty_listing_id: listingId,
    property_id: findPropertyId(db, {
      nickname: listing.nickname,
      title: listing.title || listing.name,
      address,
      city: firstValue(listing, ['address.city', 'city'])
    }),
    nickname: listing.nickname || listing.nickName || '',
    title: listing.title || listing.name || listing.nickname || '',
    address,
    city: firstValue(listing, ['address.city', 'city'], ''),
    bedrooms: asNumber(firstValue(listing, ['bedrooms', 'bedroomsCount', 'beds.bedrooms'], null), null),
    bathrooms: asNumber(firstValue(listing, ['bathrooms', 'bathroomsCount'], null), null),
    accommodates: asNumber(firstValue(listing, ['accommodates', 'occupancy', 'terms.minOccupancy'], null), null),
    listing_type: listing.type || listing.propertyType || '',
    active: listing.active === false ? 0 : 1,
    is_listed: listing.isListed === false || listing.listed === false ? 0 : 1,
    raw_json: JSON.stringify(listing),
    content_hash: hashObject(listing)
  };
  return record.guesty_listing_id ? record : null;
}

function normaliseReservation(db, reservation) {
  const reservationId = String(reservation._id || reservation.id || reservation.reservationId || '');
  const listing = reservation.listing || {};
  const guest = reservation.guest || reservation.guestDetails || {};
  const listingId = String(
    reservation.listingId ||
    reservation.listing_id ||
    listing._id ||
    listing.id ||
    firstValue(reservation, ['listing._id', 'listing.id', 'listing.listingId'], '')
  );
  const listingRecord = listingId
    ? db.prepare('SELECT property_id FROM guesty_listings WHERE guesty_listing_id = ? ORDER BY id DESC LIMIT 1').get(listingId)
    : null;
  const checkIn = dateOnly(firstValue(reservation, ['checkInDateLocalized', 'checkIn', 'checkInDate', 'arrivalDate']));
  const checkOut = dateOnly(firstValue(reservation, ['checkOutDateLocalized', 'checkOut', 'checkOutDate', 'departureDate']));
  const nights = asNumber(firstValue(reservation, ['nightsCount', 'nights'], null), daysBetween(checkIn, checkOut));
  const status = String(reservation.status || reservation.reservationStatus || '').toLowerCase();
  const channel = String(firstValue(reservation, ['integration.platform', 'source', 'channel', 'channelName'], '') || '').trim();
  const money = reservation.money || reservation.financials || reservation.accounting || {};
  const totalPrice = asNumber(firstValue(reservation, [
    'money.totalPrice',
    'money.total',
    'money.invoiceItemsTotal',
    'financials.totalPrice',
    'totalPrice',
    'price'
  ], null), 0);
  const hostPayout = asNumber(firstValue(reservation, [
    'money.hostPayout',
    'money.ownerPayout',
    'money.netIncome',
    'financials.hostPayout',
    'hostPayout',
    'ownerPayout'
  ], null), 0);
  const accommodationFare = asNumber(firstValue(reservation, [
    'money.fareAccommodation',
    'money.accommodationFare',
    'financials.accommodationFare',
    'accommodationFare'
  ], null), totalPrice || hostPayout || 0);
  const cleaningFee = asNumber(firstValue(reservation, [
    'money.cleaningFee',
    'financials.cleaningFee',
    'atTimeOfConfirmation.cleaningFee',
    'cleaningFee'
  ], null), 0);

  const propertyId = listingRecord?.property_id || findPropertyId(db, {
    nickname: listing.nickname,
    title: listing.title || listing.name,
    address: addressToString(listing.address),
    external_name: compactText(reservation.listingName, reservation.propertyName)
  });

  return reservationId ? {
    guesty_reservation_id: reservationId,
    guesty_listing_id: listingId || null,
    property_id: propertyId || null,
    confirmation_code: reservation.confirmationCode || reservation.confirmation_code || '',
    status,
    source: reservation.source || channel || '',
    channel,
    guest_name: guest.fullName || compactText(guest.firstName, guest.lastName) || reservation.guestName || '',
    guest_email: guest.email || reservation.guestEmail || '',
    check_in: checkIn,
    check_out: checkOut,
    nights,
    guests_count: asNumber(firstValue(reservation, ['guestsCount', 'numberOfGuests.numberOfAdults', 'occupancy'], null), 0),
    booked_at: reservation.createdAt || reservation.created_at || null,
    imported_at: reservation.importedAt || null,
    cancelled_at: INACTIVE_RESERVATION_RE.test(status) ? (reservation.cancelledAt || reservation.canceledAt || reservation.updatedAt || nowIso()) : null,
    last_updated_at: reservation.lastUpdatedAt || reservation.updatedAt || reservation.alteredAt || null,
    accommodation_fare: accommodationFare,
    cleaning_fee: cleaningFee,
    host_payout: hostPayout,
    total_paid: asNumber(firstValue(reservation, ['money.totalPaid', 'financials.totalPaid', 'totalPaid'], null), 0),
    total_price: totalPrice || accommodationFare + cleaningFee,
    currency: firstValue(reservation, ['money.currency', 'financials.currency', 'currency'], 'GBP') || 'GBP',
    raw_json: JSON.stringify(reservation),
    content_hash: hashObject(reservation)
  } : null;
}

function upsertListing(db, account, listing, actor = 'system') {
  const record = normaliseListing(db, listing);
  if (!record) return null;
  const before = db.prepare('SELECT * FROM guesty_listings WHERE guesty_account_id = ? AND guesty_listing_id = ?')
    .get(account.id, record.guesty_listing_id);

  db.prepare(`
    INSERT INTO guesty_listings (
      guesty_account_id, guesty_listing_id, property_id, nickname, title, address, city,
      bedrooms, bathrooms, accommodates, listing_type, active, is_listed, raw_json, content_hash
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guesty_account_id, guesty_listing_id) DO UPDATE SET
      property_id = excluded.property_id,
      nickname = excluded.nickname,
      title = excluded.title,
      address = excluded.address,
      city = excluded.city,
      bedrooms = excluded.bedrooms,
      bathrooms = excluded.bathrooms,
      accommodates = excluded.accommodates,
      listing_type = excluded.listing_type,
      active = excluded.active,
      is_listed = excluded.is_listed,
      raw_json = excluded.raw_json,
      content_hash = excluded.content_hash,
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    account.id,
    record.guesty_listing_id,
    record.property_id,
    record.nickname,
    record.title,
    record.address,
    record.city,
    record.bedrooms,
    record.bathrooms,
    record.accommodates,
    record.listing_type,
    record.active,
    record.is_listed,
    record.raw_json,
    record.content_hash
  );

  const after = db.prepare('SELECT * FROM guesty_listings WHERE guesty_account_id = ? AND guesty_listing_id = ?')
    .get(account.id, record.guesty_listing_id);
  if (!before || before.content_hash !== after.content_hash) {
    recordBusinessEvent(db, {
      event_type: before ? 'guesty_listing_updated' : 'guesty_listing_created',
      domain: 'short_lets',
      importance: 'normal',
      source_system: 'guesty',
      source_table: 'guesty_listings',
      source_id: after.id,
      external_id: record.guesty_listing_id,
      actor,
      property_id: after.property_id,
      summary: `${before ? 'Updated' : 'Imported'} Guesty listing: ${after.title || after.nickname || record.guesty_listing_id}`,
      payload: { listing: after }
    });
  }
  return after;
}

function upsertReservation(db, account, reservation, options = {}) {
  if (reservation?.listing && (reservation.listing._id || reservation.listing.id || reservation.listing.listingId)) {
    upsertListing(db, account, reservation.listing, options.actor || 'guesty');
  }
  const record = normaliseReservation(db, reservation);
  if (!record) return null;
  const before = db.prepare('SELECT * FROM guesty_reservations WHERE guesty_account_id = ? AND guesty_reservation_id = ?')
    .get(account.id, record.guesty_reservation_id);

  db.prepare(`
    INSERT INTO guesty_reservations (
      guesty_account_id, guesty_reservation_id, guesty_listing_id, property_id, confirmation_code,
      status, source, channel, guest_name, guest_email, check_in, check_out, nights, guests_count,
      booked_at, imported_at, cancelled_at, last_updated_at, accommodation_fare, cleaning_fee,
      host_payout, total_paid, total_price, currency, raw_json, content_hash
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guesty_account_id, guesty_reservation_id) DO UPDATE SET
      guesty_listing_id = excluded.guesty_listing_id,
      property_id = excluded.property_id,
      confirmation_code = excluded.confirmation_code,
      status = excluded.status,
      source = excluded.source,
      channel = excluded.channel,
      guest_name = excluded.guest_name,
      guest_email = excluded.guest_email,
      check_in = excluded.check_in,
      check_out = excluded.check_out,
      nights = excluded.nights,
      guests_count = excluded.guests_count,
      booked_at = excluded.booked_at,
      imported_at = excluded.imported_at,
      cancelled_at = excluded.cancelled_at,
      last_updated_at = excluded.last_updated_at,
      accommodation_fare = excluded.accommodation_fare,
      cleaning_fee = excluded.cleaning_fee,
      host_payout = excluded.host_payout,
      total_paid = excluded.total_paid,
      total_price = excluded.total_price,
      currency = excluded.currency,
      raw_json = excluded.raw_json,
      content_hash = excluded.content_hash,
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    account.id,
    record.guesty_reservation_id,
    record.guesty_listing_id,
    record.property_id,
    record.confirmation_code,
    record.status,
    record.source,
    record.channel,
    record.guest_name,
    record.guest_email,
    record.check_in,
    record.check_out,
    record.nights,
    record.guests_count,
    record.booked_at,
    record.imported_at,
    record.cancelled_at,
    record.last_updated_at,
    record.accommodation_fare,
    record.cleaning_fee,
    record.host_payout,
    record.total_paid,
    record.total_price,
    record.currency,
    record.raw_json,
    record.content_hash
  );

  const after = db.prepare('SELECT * FROM guesty_reservations WHERE guesty_account_id = ? AND guesty_reservation_id = ?')
    .get(account.id, record.guesty_reservation_id);

  db.prepare(`
    INSERT OR IGNORE INTO guesty_reservation_versions (
      guesty_account_id, reservation_id, guesty_reservation_id, event_type, content_hash, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(account.id, after.id, record.guesty_reservation_id, options.event_type || null, record.content_hash, record.raw_json);

  if (!before || before.content_hash !== after.content_hash) {
    const cancelledNow = !INACTIVE_RESERVATION_RE.test(String(before?.status || '')) && INACTIVE_RESERVATION_RE.test(String(after.status || ''));
    const eventType = cancelledNow ? 'guesty_reservation_cancelled' : before ? 'guesty_reservation_updated' : 'guesty_reservation_created';
    recordBusinessEvent(db, {
      event_type: eventType,
      domain: 'short_lets',
      importance: cancelledNow || options.importance === 'high' ? 'high' : 'normal',
      source_system: 'guesty',
      source_table: 'guesty_reservations',
      source_id: after.id,
      external_id: after.guesty_reservation_id,
      actor: options.actor || 'guesty',
      property_id: after.property_id,
      happened_at: after.last_updated_at || after.booked_at || nowIso(),
      summary: `${after.status || 'reservation'} booking ${after.confirmation_code || after.guesty_reservation_id}${after.check_in ? ` from ${after.check_in}` : ''}`,
      payload: {
        before: before ? {
          status: before.status,
          check_in: before.check_in,
          check_out: before.check_out,
          host_payout: before.host_payout,
          total_price: before.total_price
        } : null,
        after: {
          status: after.status,
          channel: after.channel || after.source,
          check_in: after.check_in,
          check_out: after.check_out,
          nights: after.nights,
          host_payout: after.host_payout,
          total_price: after.total_price,
          currency: after.currency
        }
      }
    });
  }
  return after;
}

async function fetchReservationDetails(db, account, ids) {
  const batches = [];
  for (let i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
  const details = [];
  for (const batch of batches) {
    const params = new URLSearchParams();
    for (const id of batch) params.append('reservationIds', id);
    params.set('includePaymentsTemplate', 'false');
    params.set('mergeAccommodationFarePriceComponents', 'false');
    try {
      const data = await guestyRequest(db, account, 'GET', `/reservations-v3?${params.toString()}`, { timeout: 40000 });
      details.push(...extractArray(data));
    } catch (error) {
      console.warn('[Guesty] Reservation detail fetch failed:', error.response?.data || error.message);
    }
  }
  return details;
}

async function syncListings(accountId = null, options = {}) {
  const db = getDb();
  try {
    const account = getAccount(db, accountId);
    let imported = 0;
    let total = 0;
    const limit = Math.min(Number(options.limit || 100), 100);
    const maxPages = Math.min(Number(options.max_pages || 10), 50);
    const fields = options.fields || '_id id nickname title name type address accommodates bedrooms bathrooms active isListed listed';

    for (let page = 0; page < maxPages; page += 1) {
      const data = await guestyRequest(db, account, 'GET', '/listings', {
        params: { limit, skip: page * limit, fields, sort: '-updatedAt' },
        timeout: 40000
      });
      const listings = extractArray(data);
      total += listings.length;
      for (const listing of listings) {
        if (upsertListing(db, account, listing, actorFromUser(options.user, 'guesty'))) imported += 1;
      }
      if (listings.length < limit) break;
    }
    return { imported, total };
  } finally {
    db.close();
  }
}

async function syncReservations(accountId = null, options = {}) {
  const db = getDb();
  try {
    const account = getAccount(db, accountId);
    let imported = 0;
    let total = 0;
    const limit = Math.min(Number(options.limit || 100), 100);
    const maxPages = Math.min(Number(options.max_pages || 5), 30);
    const fields = options.fields || [
      '_id', 'id', 'confirmationCode', 'status', 'source', 'integration.platform', 'listing', 'listingId',
      'guest', 'guestId', 'guestName', 'checkIn', 'checkOut', 'checkInDateLocalized', 'checkOutDateLocalized',
      'nightsCount', 'guestsCount', 'createdAt', 'importedAt', 'lastUpdatedAt', 'updatedAt', 'money'
    ].join(' ');

    for (let page = 0; page < maxPages; page += 1) {
      const data = await guestyRequest(db, account, 'GET', '/reservations', {
        params: { limit, skip: page * limit, fields, sort: '-lastUpdatedAt' },
        timeout: 50000
      });
      const reservations = extractArray(data);
      const ids = reservations.map(item => String(item._id || item.id || item.reservationId || '')).filter(Boolean);
      const detailRows = await fetchReservationDetails(db, account, ids);
      const detailMap = new Map(detailRows.map(row => [String(row._id || row.id || row.reservationId), row]));

      total += reservations.length;
      for (const reservation of reservations) {
        const id = String(reservation._id || reservation.id || reservation.reservationId || '');
        const richReservation = detailMap.get(id) || reservation;
        if (upsertReservation(db, account, richReservation, { event_type: 'sync', actor: actorFromUser(options.user, 'guesty') })) imported += 1;
      }
      if (reservations.length < limit) break;
    }
    return { imported, total };
  } finally {
    db.close();
  }
}

function isActiveReservation(row) {
  const status = String(row.status || '').toLowerCase();
  if (!status) return true;
  if (INACTIVE_RESERVATION_RE.test(status)) return false;
  return ACTIVE_RESERVATION_STATUSES.has(status) || /confirm|reserv|checked|complete/.test(status);
}

function refreshDailyMetrics(accountId = null, options = {}) {
  const db = getDb();
  try {
    const account = getAccount(db, accountId);
    const from = dateOnly(options.from || addDays(new Date(), -90));
    const to = dateOnly(options.to || addDays(new Date(), 180));
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    const listings = db.prepare(`
      SELECT *
      FROM guesty_listings
      WHERE guesty_account_id = ? AND active = 1
    `).all(account.id);
    const reservations = db.prepare(`
      SELECT *
      FROM guesty_reservations
      WHERE guesty_account_id = ?
        AND check_out >= ?
        AND check_in <= ?
    `).all(account.id, from, to).filter(isActiveReservation);

    db.prepare('DELETE FROM guesty_daily_metrics WHERE guesty_account_id = ? AND metric_date BETWEEN ? AND ?').run(account.id, from, to);

    const listingMap = new Map(listings.map(listing => [listing.guesty_listing_id, listing]));
    const metrics = new Map();
    for (const listing of listings) {
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        const metricDate = dayKey(d);
        metrics.set(`${listing.guesty_listing_id}:${metricDate}`, {
          guesty_account_id: account.id,
          property_id: listing.property_id || null,
          guesty_listing_id: listing.guesty_listing_id,
          metric_date: metricDate,
          available_nights: 1,
          occupied_nights: 0,
          booked_revenue: 0,
          booked_net_revenue: 0,
          currency: 'GBP'
        });
      }
    }

    for (const reservation of reservations) {
      const listing = listingMap.get(reservation.guesty_listing_id);
      if (!listing) continue;
      const reservationStart = new Date(`${reservation.check_in}T00:00:00.000Z`);
      const reservationEnd = new Date(`${reservation.check_out}T00:00:00.000Z`);
      const nights = Math.max(1, Number(reservation.nights || daysBetween(reservation.check_in, reservation.check_out) || 1));
      const grossNightly = asNumber(reservation.total_price || reservation.accommodation_fare || reservation.host_payout, 0) / nights;
      const netNightly = asNumber(reservation.host_payout || reservation.total_price || reservation.accommodation_fare, 0) / nights;

      for (let d = new Date(Math.max(reservationStart.getTime(), start.getTime())); d < reservationEnd && d < end; d.setDate(d.getDate() + 1)) {
        const metricDate = dayKey(d);
        const key = `${reservation.guesty_listing_id}:${metricDate}`;
        const metric = metrics.get(key);
        if (!metric) continue;
        metric.occupied_nights = 1;
        metric.booked_revenue += grossNightly;
        metric.booked_net_revenue += netNightly;
        metric.currency = reservation.currency || metric.currency || 'GBP';
      }
    }

    const insert = db.prepare(`
      INSERT INTO guesty_daily_metrics (
        guesty_account_id, property_id, guesty_listing_id, metric_date, available_nights,
        occupied_nights, booked_revenue, booked_net_revenue, adr, revpar, currency
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let written = 0;
    for (const metric of metrics.values()) {
      const adr = metric.occupied_nights ? metric.booked_revenue / metric.occupied_nights : 0;
      const revpar = metric.available_nights ? metric.booked_revenue / metric.available_nights : 0;
      insert.run(
        metric.guesty_account_id,
        metric.property_id,
        metric.guesty_listing_id,
        metric.metric_date,
        metric.available_nights,
        metric.occupied_nights,
        metric.booked_revenue,
        metric.booked_net_revenue,
        adr,
        revpar,
        metric.currency
      );
      written += 1;
    }
    return { from, to, written };
  } finally {
    db.close();
  }
}

async function syncAccount(accountId = null, options = {}) {
  const listings = await syncListings(accountId, options);
  const reservations = await syncReservations(accountId, options);
  const metrics = refreshDailyMetrics(accountId, options);
  const db = getDb();
  try {
    const account = getAccount(db, accountId);
    db.prepare('UPDATE guesty_accounts SET last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(account.id);
    recordBusinessEvent(db, {
      event_type: 'guesty_sync_completed',
      domain: 'short_lets',
      importance: 'normal',
      source_system: 'guesty',
      source_table: 'guesty_accounts',
      source_id: account.id,
      actor: actorFromUser(options.user, 'guesty'),
      summary: `Guesty sync completed: ${listings.total} listings observed, ${reservations.total} reservations observed`,
      payload: { listings, reservations, metrics }
    });
    return { account_id: account.id, listings, reservations, metrics };
  } finally {
    db.close();
  }
}

async function syncAllAccounts(options = {}) {
  const db = getDb();
  let accounts;
  try {
    ensureEnvAccount(db);
    accounts = db.prepare('SELECT id FROM guesty_accounts WHERE sync_enabled = 1 ORDER BY id').all();
  } finally {
    db.close();
  }
  const results = [];
  for (const account of accounts) {
    results.push(await syncAccount(account.id, options));
  }
  return { accounts: results.length, results };
}

let schedulerStarted = false;
function startGuestyScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const intervalMinutes = Number(process.env.GUESTY_SYNC_INTERVAL_MINUTES || 60);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;
  const run = () => syncAllAccounts({ trigger: 'scheduler' }).catch(error => {
    console.warn('[Guesty] Scheduled sync skipped:', error.message);
  });
  setTimeout(run, 30000);
  setInterval(run, intervalMinutes * 60 * 1000);
}

function publicWebhookUrl(baseUrl) {
  const explicit = process.env.GUESTY_WEBHOOK_URL;
  const root = explicit || `${String(baseUrl || process.env.PUBLIC_BASE_URL || 'https://maintenance.52oldelvet.com').replace(/\/+$/, '')}/api/guesty/webhook`;
  const token = process.env.GUESTY_WEBHOOK_TOKEN;
  if (!token) return root;
  const url = new URL(root);
  url.searchParams.set('token', token);
  return url.toString();
}

async function registerWebhook(accountId = null, options = {}) {
  const db = getDb();
  try {
    const account = getAccount(db, accountId);
    const url = publicWebhookUrl(options.base_url);
    const events = options.events?.length ? options.events : DEFAULT_WEBHOOK_EVENTS;
    const response = await guestyRequest(db, account, 'POST', '/webhooks', {
      body: { url, events },
      timeout: 30000
    });
    db.prepare(`
      UPDATE guesty_accounts
      SET webhook_id = ?, webhook_url = ?, webhook_events_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(response?._id || response?.id || null, url, JSON.stringify(events), account.id);
    recordBusinessEvent(db, {
      event_type: 'guesty_webhook_registered',
      domain: 'short_lets',
      importance: 'high',
      source_system: 'guesty',
      source_table: 'guesty_accounts',
      source_id: account.id,
      external_id: response?._id || response?.id || null,
      actor: actorFromUser(options.user, 'guesty'),
      summary: `Guesty webhook registered for ${events.length} events`,
      payload: { url, events, response }
    });
    return { webhook: response, url, events };
  } finally {
    db.close();
  }
}

function webhookTokenIsValid(req) {
  const expected = process.env.GUESTY_WEBHOOK_TOKEN;
  if (!expected) return true;
  return req.query?.token === expected || req.get('x-ffr-webhook-token') === expected;
}

function inferExternalId(payload) {
  return String(
    payload?.reservation?._id ||
    payload?.reservation?.id ||
    payload?.reservationId ||
    payload?.listing?._id ||
    payload?.listing?.id ||
    payload?.listingId ||
    payload?.task?._id ||
    payload?.task?.id ||
    payload?.payment?._id ||
    payload?.payment?.id ||
    ''
  );
}

function createShortLetTask(db, details) {
  const sourceRef = details.source_ref;
  if (!sourceRef) return null;
  const existing = db.prepare('SELECT id FROM agent_tasks WHERE source = ? AND source_ref = ?').get('guesty', sourceRef);
  if (existing) return existing.id;
  const id = db.prepare(`
    INSERT INTO agent_tasks (title, description, domain, property_id, priority, status, source, source_ref, assigned_to, created_by)
    VALUES (?, ?, 'short_lets', ?, ?, 'open', 'guesty', ?, ?, 'guesty')
  `).run(
    details.title,
    details.description || null,
    details.property_id || null,
    details.priority || 'medium',
    sourceRef,
    details.assigned_to || 'hannah@52oldelvet.com'
  ).lastInsertRowid;

  recordBusinessEvent(db, {
    event_type: 'task_created',
    domain: 'short_lets',
    importance: details.priority === 'high' ? 'high' : 'normal',
    source_system: 'guesty',
    source_table: 'agent_tasks',
    source_id: id,
    external_id: sourceRef,
    actor: 'guesty',
    property_id: details.property_id || null,
    summary: `Short-let task created: ${details.title}`,
    payload: details
  });
  return id;
}

async function handleWebhook(req) {
  if (!webhookTokenIsValid(req)) {
    const error = new Error('Invalid Guesty webhook token');
    error.status = 401;
    throw error;
  }

  const payload = req.body || {};
  const eventType = String(payload.event || payload.eventType || payload.type || 'guesty.webhook');
  const externalId = inferExternalId(payload);
  const eventUid = String(payload.id || payload.eventId || `guesty:${eventType}:${externalId}:${hashObject(payload)}`);

  const db = getDb();
  let eventRowId;
  try {
    ensureEnvAccount(db);
    const account = payload.accountId
      ? db.prepare('SELECT * FROM guesty_accounts WHERE guesty_account_id = ? OR id = ? ORDER BY id LIMIT 1').get(payload.accountId, payload.accountId)
      : db.prepare('SELECT * FROM guesty_accounts WHERE sync_enabled = 1 ORDER BY id LIMIT 1').get();

    eventRowId = db.prepare(`
      INSERT OR IGNORE INTO guesty_webhook_events (event_uid, guesty_account_id, event_type, external_id, status, raw_json)
      VALUES (?, ?, ?, ?, 'received', ?)
    `).run(eventUid, account?.id || null, eventType, externalId || null, JSON.stringify(payload)).lastInsertRowid;

    if (account) db.prepare('UPDATE guesty_accounts SET last_webhook_at = CURRENT_TIMESTAMP WHERE id = ?').run(account.id);

    recordBusinessEvent(db, {
      event_uid: `guesty-webhook:${eventUid}`,
      event_type: 'guesty_webhook_received',
      domain: 'short_lets',
      importance: /payment|messageReceived|reservation/i.test(eventType) ? 'high' : 'normal',
      source_system: 'guesty',
      source_table: 'guesty_webhook_events',
      source_id: eventRowId || eventUid,
      external_id: externalId || eventUid,
      actor: 'guesty',
      summary: `Guesty webhook received: ${eventType}`,
      payload: { event_type: eventType, external_id: externalId }
    });

    let reservationRecord = null;
    if (payload.reservation && account) {
      reservationRecord = upsertReservation(db, account, payload.reservation, { event_type: eventType, actor: 'guesty', importance: /payment|failed/i.test(eventType) ? 'high' : 'normal' });
    }
    if (payload.listing && account) upsertListing(db, account, payload.listing, 'guesty');

    if (process.env.GUESTY_FETCH_ON_WEBHOOK === 'true' && /reservation\.(created|new|updated)/i.test(eventType) && account && externalId) {
      try {
        const [fresh] = await fetchReservationDetails(db, account, [externalId]);
        if (fresh) reservationRecord = upsertReservation(db, account, fresh, { event_type: eventType, actor: 'guesty' }) || reservationRecord;
      } catch {
        // The webhook payload is still stored; scheduled/manual sync reconciles the latest state.
      }
    }

    if (/messageReceived/i.test(eventType)) {
      createShortLetTask(db, {
        source_ref: eventUid,
        property_id: reservationRecord?.property_id || null,
        priority: 'medium',
        title: `Reply to Guesty guest message${reservationRecord?.confirmation_code ? ` (${reservationRecord.confirmation_code})` : ''}`,
        description: 'A Guesty reservation message was received. Review the guest context, draft a reply, and check whether access, cleaning, linen or booking details need updating.'
      });
    }

    if (/payments\.failed/i.test(eventType)) {
      createShortLetTask(db, {
        source_ref: eventUid,
        property_id: reservationRecord?.property_id || null,
        priority: 'high',
        title: `Resolve Guesty payment failure${reservationRecord?.confirmation_code ? ` (${reservationRecord.confirmation_code})` : ''}`,
        description: 'Guesty reported a failed payment. Check the reservation, payment status, channel rules and guest communications before confirming any booking or access details.'
      });
    }

    if (account) {
      try { refreshDailyMetrics(account.id); } catch (error) { console.warn('[Guesty] Metrics refresh after webhook failed:', error.message); }
    }

    db.prepare('UPDATE guesty_webhook_events SET status = ?, processed_at = CURRENT_TIMESTAMP WHERE event_uid = ?')
      .run('processed', eventUid);
    return { received: true, event_uid: eventUid, event_type: eventType, external_id: externalId || null };
  } catch (error) {
    if (eventRowId) {
      try {
        db.prepare('UPDATE guesty_webhook_events SET status = ?, error = ? WHERE id = ?').run('error', error.message, eventRowId);
      } catch {}
    }
    throw error;
  } finally {
    db.close();
  }
}

function periodMetrics(db, from, to, propertyId = null) {
  const params = [from, to];
  let propertyWhere = '';
  if (propertyId) {
    propertyWhere = 'AND property_id = ?';
    params.push(propertyId);
  }
  const row = db.prepare(`
    SELECT
      SUM(available_nights) as available_nights,
      SUM(occupied_nights) as occupied_nights,
      SUM(booked_revenue) as booked_revenue,
      SUM(booked_net_revenue) as booked_net_revenue,
      AVG(CASE WHEN occupied_nights > 0 THEN adr ELSE NULL END) as adr,
      AVG(revpar) as revpar
    FROM guesty_daily_metrics
    WHERE metric_date >= ? AND metric_date < ?
    ${propertyWhere}
  `).get(...params) || {};
  const available = Number(row.available_nights || 0);
  const occupied = Number(row.occupied_nights || 0);
  return {
    available_nights: available,
    occupied_nights: occupied,
    gap_nights: Math.max(0, available - occupied),
    occupancy_pct: available ? Math.round((occupied / available) * 100) : 0,
    booked_revenue: Number(row.booked_revenue || 0),
    booked_net_revenue: Number(row.booked_net_revenue || 0),
    adr: occupied ? Number(row.booked_revenue || 0) / occupied : 0,
    revpar: available ? Number(row.booked_revenue || 0) / available : 0
  };
}

function getPerformanceSummary(dbArg = null) {
  const db = dbArg || getDb();
  try {
    ensureEnvAccount(db);
    const accounts = db.prepare('SELECT * FROM guesty_accounts ORDER BY sync_enabled DESC, created_at DESC').all();
    const today = dateOnly(new Date());
    const tomorrow = dateOnly(addDays(new Date(), 1));
    const next30 = dateOnly(addDays(new Date(), 30));
    const next90 = dateOnly(addDays(new Date(), 90));
    const last30 = dateOnly(addDays(new Date(), -30));

    const totals = {
      accounts: accounts.length,
      connected: accounts.some(account => account.sync_enabled && (account.client_id || account.access_token)),
      webhook_configured: accounts.some(account => account.webhook_url || account.webhook_id),
      listings: db.prepare('SELECT COUNT(*) as count FROM guesty_listings WHERE active = 1').get()?.count || 0,
      unlinked_listings: db.prepare('SELECT COUNT(*) as count FROM guesty_listings WHERE property_id IS NULL').get()?.count || 0,
      reservations: db.prepare('SELECT COUNT(*) as count FROM guesty_reservations').get()?.count || 0,
      upcoming_reservations: db.prepare(`
        SELECT COUNT(*) as count
        FROM guesty_reservations
        WHERE check_out >= ? AND (status IS NULL OR status NOT LIKE '%cancel%')
      `).get(today)?.count || 0,
      checkins_today: db.prepare(`
        SELECT COUNT(*) as count FROM guesty_reservations
        WHERE check_in = ? AND (status IS NULL OR status NOT LIKE '%cancel%')
      `).get(today)?.count || 0,
      checkouts_today: db.prepare(`
        SELECT COUNT(*) as count FROM guesty_reservations
        WHERE check_out = ? AND (status IS NULL OR status NOT LIKE '%cancel%')
      `).get(today)?.count || 0,
      payment_failed_events_30d: db.prepare(`
        SELECT COUNT(*) as count FROM guesty_webhook_events
        WHERE event_type = 'payments.failed' AND received_at >= datetime('now', '-30 days')
      `).get()?.count || 0,
      open_short_let_tasks: db.prepare(`
        SELECT COUNT(*) as count FROM agent_tasks
        WHERE domain = 'short_lets' AND status = 'open'
      `).get()?.count || 0,
      last_sync_at: accounts.map(account => account.last_sync_at).filter(Boolean).sort().pop() || null,
      last_webhook_at: accounts.map(account => account.last_webhook_at).filter(Boolean).sort().pop() || null
    };

    const next30Metrics = periodMetrics(db, today, next30);
    const next90Metrics = periodMetrics(db, today, next90);
    const last30Metrics = periodMetrics(db, last30, today);

    const properties = db.prepare(`
      SELECT
        COALESCE(p.id, gl.property_id) as property_id,
        COALESCE(p.name, gl.title, gl.nickname, 'Unlinked Guesty listing') as property_name,
        COUNT(DISTINCT gl.guesty_listing_id) as listing_count,
        MIN(gl.title) as sample_listing,
        SUM(CASE WHEN dm.metric_date >= ? AND dm.metric_date < ? THEN dm.available_nights ELSE 0 END) as available_30,
        SUM(CASE WHEN dm.metric_date >= ? AND dm.metric_date < ? THEN dm.occupied_nights ELSE 0 END) as occupied_30,
        SUM(CASE WHEN dm.metric_date >= ? AND dm.metric_date < ? THEN dm.booked_revenue ELSE 0 END) as revenue_30,
        SUM(CASE WHEN dm.metric_date >= ? AND dm.metric_date < ? THEN dm.booked_net_revenue ELSE 0 END) as net_revenue_30,
        SUM(CASE WHEN dm.metric_date >= ? AND dm.metric_date < ? THEN dm.available_nights ELSE 0 END) as available_90,
        SUM(CASE WHEN dm.metric_date >= ? AND dm.metric_date < ? THEN dm.occupied_nights ELSE 0 END) as occupied_90,
        SUM(CASE WHEN dm.metric_date >= ? AND dm.metric_date < ? THEN dm.booked_revenue ELSE 0 END) as revenue_90
      FROM guesty_listings gl
      LEFT JOIN properties p ON p.id = gl.property_id
      LEFT JOIN guesty_daily_metrics dm ON dm.guesty_account_id = gl.guesty_account_id AND dm.guesty_listing_id = gl.guesty_listing_id
      WHERE gl.active = 1
      GROUP BY COALESCE(p.id, gl.id), property_name
      ORDER BY revenue_30 DESC, occupied_30 DESC, property_name COLLATE NOCASE
    `).all(
      today, next30, today, next30, today, next30, today, next30,
      today, next90, today, next90, today, next90
    ).map(row => ({
      ...row,
      available_30: Number(row.available_30 || 0),
      occupied_30: Number(row.occupied_30 || 0),
      revenue_30: Number(row.revenue_30 || 0),
      net_revenue_30: Number(row.net_revenue_30 || 0),
      available_90: Number(row.available_90 || 0),
      occupied_90: Number(row.occupied_90 || 0),
      revenue_90: Number(row.revenue_90 || 0),
      occupancy_30: row.available_30 ? Math.round((Number(row.occupied_30 || 0) / Number(row.available_30 || 0)) * 100) : 0,
      occupancy_90: row.available_90 ? Math.round((Number(row.occupied_90 || 0) / Number(row.available_90 || 0)) * 100) : 0,
      gap_nights_30: Math.max(0, Number(row.available_30 || 0) - Number(row.occupied_30 || 0)),
      adr_30: row.occupied_30 ? Number(row.revenue_30 || 0) / Number(row.occupied_30 || 1) : 0,
      revpar_30: row.available_30 ? Number(row.revenue_30 || 0) / Number(row.available_30 || 1) : 0
    }));

    const upcoming = db.prepare(`
      SELECT gr.*, p.name as property_name, gl.title as listing_title, gl.nickname as listing_nickname
      FROM guesty_reservations gr
      LEFT JOIN properties p ON p.id = gr.property_id
      LEFT JOIN guesty_listings gl ON gl.guesty_account_id = gr.guesty_account_id AND gl.guesty_listing_id = gr.guesty_listing_id
      WHERE gr.check_out >= ? AND gr.check_in <= ?
        AND (gr.status IS NULL OR gr.status NOT LIKE '%cancel%')
      ORDER BY gr.check_in ASC, gr.check_out ASC
      LIMIT 20
    `).all(today, next30);

    const recent = db.prepare(`
      SELECT gr.*, p.name as property_name, gl.title as listing_title, gl.nickname as listing_nickname
      FROM guesty_reservations gr
      LEFT JOIN properties p ON p.id = gr.property_id
      LEFT JOIN guesty_listings gl ON gl.guesty_account_id = gr.guesty_account_id AND gl.guesty_listing_id = gr.guesty_listing_id
      ORDER BY COALESCE(gr.last_updated_at, gr.booked_at, gr.updated_at) DESC
      LIMIT 20
    `).all();

    const channels = db.prepare(`
      SELECT COALESCE(NULLIF(channel, ''), NULLIF(source, ''), 'unknown') as channel,
        COUNT(*) as reservation_count,
        SUM(COALESCE(total_price, accommodation_fare, host_payout, 0)) as revenue,
        SUM(COALESCE(host_payout, 0)) as net_revenue
      FROM guesty_reservations
      WHERE check_in >= ? AND check_in < ?
        AND (status IS NULL OR status NOT LIKE '%cancel%')
      GROUP BY COALESCE(NULLIF(channel, ''), NULLIF(source, ''), 'unknown')
      ORDER BY revenue DESC
    `).all(last30, next90);

    const alerts = [];
    if (!totals.connected) alerts.push({ tone: 'warning', title: 'Guesty not connected', detail: 'Add Guesty Client ID and Client Secret to start short-let performance sync.' });
    if (totals.unlinked_listings) alerts.push({ tone: 'warning', title: 'Unlinked Guesty listings', detail: `${totals.unlinked_listings} listing${totals.unlinked_listings === 1 ? '' : 's'} need matching to FFR properties.` });
    if (totals.payment_failed_events_30d) alerts.push({ tone: 'danger', title: 'Payment failures', detail: `${totals.payment_failed_events_30d} payment failure webhook${totals.payment_failed_events_30d === 1 ? '' : 's'} in the last 30 days.` });
    if (totals.checkins_today || totals.checkouts_today) alerts.push({ tone: 'info', title: 'Turnaround today', detail: `${totals.checkins_today} check-in${totals.checkins_today === 1 ? '' : 's'} and ${totals.checkouts_today} check-out${totals.checkouts_today === 1 ? '' : 's'} today.` });
    if (!totals.webhook_configured && totals.connected) alerts.push({ tone: 'info', title: 'Register Guesty webhook', detail: 'Initial sync works, but webhooks are needed for live reservation, message, payment and calendar changes.' });

    const suggestedActions = [];
    if (!totals.connected) suggestedActions.push({ title: 'Connect Guesty API', agent_key: null, detail: 'Configure credentials so FFR OS can import listings, reservations and financials.' });
    if (!totals.webhook_configured && totals.connected) suggestedActions.push({ title: 'Register Guesty webhook', agent_key: null, detail: 'Subscribe FFR OS to Guesty reservation, payment, calendar and message events.' });
    if (totals.payment_failed_events_30d || totals.open_short_let_tasks) suggestedActions.push({ title: 'Run Short-Let Operator', agent_key: 'short_let_operator', detail: 'Review payment failures, guest messages, same-day turnarounds and gap nights.' });
    const gapHeavy = properties.find(property => property.gap_nights_30 >= 7);
    if (gapHeavy) suggestedActions.push({ title: `Review gap nights at ${gapHeavy.property_name}`, agent_key: 'short_let_operator', detail: `${gapHeavy.gap_nights_30} open nights in the next 30 days.` });

    return {
      connected: totals.connected,
      accounts: accounts.map(redactAccount),
      totals: {
        ...totals,
        last_30: last30Metrics,
        next_30: next30Metrics,
        next_90: next90Metrics
      },
      today: {
        checkins: upcoming.filter(row => row.check_in === today),
        checkouts: upcoming.filter(row => row.check_out === today),
        tomorrow_checkins: upcoming.filter(row => row.check_in === tomorrow),
        tomorrow_checkouts: upcoming.filter(row => row.check_out === tomorrow)
      },
      properties,
      upcoming,
      recent,
      channels,
      alerts,
      suggested_actions: suggestedActions.slice(0, 5),
      webhook_events: db.prepare(`
        SELECT *
        FROM guesty_webhook_events
        ORDER BY received_at DESC
        LIMIT 20
      `).all()
    };
  } finally {
    if (!dbArg) db.close();
  }
}

module.exports = {
  DEFAULT_WEBHOOK_EVENTS,
  getPerformanceSummary,
  handleWebhook,
  listAccounts,
  publicWebhookUrl,
  refreshDailyMetrics,
  registerWebhook,
  startGuestyScheduler,
  syncAccount,
  syncAllAccounts,
  syncListings,
  syncReservations,
  upsertListing,
  upsertReservation
};
