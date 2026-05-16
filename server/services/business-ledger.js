const crypto = require('crypto');

const SECRET_RE = /(password|token|secret|api[_-]?key|credentials|access[_-]?token|refresh[_-]?token|client[_-]?secret)/i;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashObject(value) {
  return crypto.createHash('sha1').update(stableStringify(value)).digest('hex');
}

function actorFromUser(user, fallback = 'system') {
  return user?.email || user?.name || fallback;
}

function redactValue(key, value) {
  if (SECRET_RE.test(String(key || ''))) {
    if (value == null || value === '') return value;
    return '[redacted]';
  }
  if (Array.isArray(value)) return value.map((item, index) => redactValue(`${key || 'item'}_${index}`, item));
  if (value && typeof value === 'object') return redactSecrets(value);
  return value;
}

function redactSecrets(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, redactValue(key, value)]));
}

function diffObjects(before = {}, after = {}, options = {}) {
  const keys = options.keys || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const changes = {};
  for (const key of keys) {
    const oldValue = before?.[key];
    const newValue = after?.[key];
    if (stableStringify(oldValue) !== stableStringify(newValue)) {
      changes[key] = {
        from: redactValue(key, oldValue),
        to: redactValue(key, newValue)
      };
    }
  }
  return changes;
}

function makeEventUid(event) {
  const sourceIdentity = [
    event.event_type || 'event',
    event.source_system || 'ffr_os',
    event.source_table || '',
    event.source_id || '',
    event.external_id || '',
    event.content_hash || '',
    event.happened_at || '',
    event.summary || ''
  ].join('|');
  return `${event.event_type || 'event'}:${hashObject(sourceIdentity)}`;
}

function recordBusinessEvent(db, event = {}) {
  const payload = redactSecrets(event.payload || event.payload_json || {});
  const raw = redactSecrets(event.raw || event.raw_json || {});
  const happenedAt = event.happened_at || new Date().toISOString();
  const contentHash = event.content_hash || hashObject({
    event_type: event.event_type,
    source_system: event.source_system,
    source_table: event.source_table,
    source_id: event.source_id,
    external_id: event.external_id,
    summary: event.summary,
    payload,
    raw
  });
  const eventUid = event.event_uid || makeEventUid({ ...event, happened_at: happenedAt, content_hash: contentHash });

  db.prepare(`
    INSERT OR IGNORE INTO business_event_ledger (
      event_uid, event_type, domain, importance, source_system, source_table, source_id, external_id,
      actor, property_id, tenant_id, issue_id, happened_at, observed_at, summary, payload_json, raw_json, content_hash
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, ?, ?, ?, ?)
  `).run(
    eventUid,
    event.event_type || 'business_event',
    event.domain || 'operations',
    event.importance || 'normal',
    event.source_system || 'ffr_os',
    event.source_table || null,
    event.source_id == null ? null : String(event.source_id),
    event.external_id == null ? null : String(event.external_id),
    event.actor || 'system',
    event.property_id || null,
    event.tenant_id || null,
    event.issue_id || null,
    happenedAt,
    event.summary || null,
    JSON.stringify(payload),
    Object.keys(raw).length ? JSON.stringify(raw) : null,
    contentHash
  );

  return { event_uid: eventUid, content_hash: contentHash };
}

function recordEntityChange(db, options = {}) {
  const changes = options.changes || diffObjects(options.before || {}, options.after || {}, { keys: options.keys });
  if (!Object.keys(changes).length && !options.alwaysRecord) return null;
  return recordBusinessEvent(db, {
    event_type: options.eventType || `${options.entityType || 'entity'}_${options.action || 'updated'}`,
    domain: options.domain || 'operations',
    importance: options.importance || 'normal',
    source_system: options.sourceSystem || 'ffr_os',
    source_table: options.sourceTable || options.entityType || null,
    source_id: options.entityId,
    external_id: options.externalId,
    actor: options.actor || 'system',
    property_id: options.property_id || options.after?.property_id || options.before?.property_id || null,
    tenant_id: options.tenant_id || options.after?.tenant_id || options.before?.tenant_id || null,
    issue_id: options.issue_id || options.after?.issue_id || options.before?.issue_id || null,
    summary: options.summary,
    payload: {
      action: options.action || 'updated',
      entity_type: options.entityType,
      entity_id: options.entityId,
      changes,
      before: options.includeBeforeAfter ? redactSecrets(options.before || {}) : undefined,
      after: options.includeBeforeAfter ? redactSecrets(options.after || {}) : undefined,
      ...redactSecrets(options.payload || {})
    },
    raw: options.raw,
    happened_at: options.happened_at
  });
}

module.exports = {
  actorFromUser,
  diffObjects,
  hashObject,
  recordBusinessEvent,
  recordEntityChange,
  redactSecrets,
  stableStringify
};
