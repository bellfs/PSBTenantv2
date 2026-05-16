const crypto = require('crypto');

const AGENT_BY_DOMAIN = {
  operations: 'ops_copilot',
  maintenance: 'maintenance_triage',
  compliance: 'compliance_guardian',
  leasing: 'leasing_revenue',
  turnaround: 'turnaround_orchestrator',
  contractors: 'contractor_value',
  finance: 'finance_reconciler',
  utilities: 'utilities_procurement',
  short_lets: 'short_let_operator',
  development: 'development_deals'
};

const DOMAIN_RULES = [
  ['compliance', /\b(gas safety|eicr|epc|hmo|fire|smoke alarm|fire alarm|certificate|cert|licen[cs]e|inspection|renters rights|right to rent|deposit scheme|dps|notice|24 ?hours|access notice)\b/i],
  ['utilities', /\b(utility|utilities|meter|mprn|mpan|gas meter|electric|electricity|water|supplier|sefe|crown|octopus|fuse|broker|standing charge|kwh|change of tenancy|cot|broadband|wifi|internet|hosted|onestream|plusnet)\b/i],
  ['finance', /\b(invoice|paid|payment|pay |bank|wise|starling|pleo|rent|arrears|late payer|deposit|bill|budget|cost|spend|quote|stripe|bookkeeping|forecast|cashflow)\b/i],
  ['leasing', /\b(viewing|viewings|sturents|enquiry|lead|contract|sign|signed|guarantor|reserve|reservation|pricing|price|pppw|calendar|calendly|docusign|squarespace)\b/i],
  ['short_lets', /\b(guesty|airbnb|booking\.com|booking|ota|guest|linen|cleaning fee|housekeeping|check[ -]?in|check[ -]?out|access code|owner stay|net income|short.?let)\b/i],
  ['contractors', /\b(contractor|quote|plumber|electrician|joiner|roofer|cleaner|cleaners|florin|romanians|day rate|labour|crew|timesheet|workforce)\b/i],
  ['turnaround', /\b(summer|turnaround|handover|traffic light|job list|jobs list|key|keys|lockbox|clean|cleaners|furniture|beds|mattress|paint|painting|carpet|doors|windows|ready for tenants)\b/i],
  ['development', /\b(acquisition|deal|planning|listed|heritage|survey|sale|solicitor|completion|capex|lender|investor|valuation|development)\b/i],
  ['maintenance', /\b(repair|issue|leak|damp|mould|boiler|heating|plumbing|electrical|broken|blocked|overflow|door|window|bathroom|kitchen|roof|lock|appliance)\b/i]
];

const ACTION_RE = /\b(please can|can you|could you|would it be possible|need to|needs to|we need|must|make sure|remind|chase|follow up|book|arrange|ask|send|call|upload|update|check|confirm|sort|fix|get .* sorted|add .* calendar|put .* calendar|find out|look into|deal with|action)\b/i;
const URGENT_RE = /\b(urgent|asap|emergency|today|tomorrow|this morning|this afternoon|by \d{1,2}(st|nd|rd|th)?|deadline|must be completed|racing against time|complaint)\b/i;
const APPROVAL_RE = /\b(pay|payment|invoice|bank|wise|starling|pleo|contract|deposit|rent|legal|notice|compliant|renters rights|lawyer|supplier contract|sign|pricing|price|calendar open|availability|booking|guesty|airbnb|booking\.com|fire|gas|hmo|eicr|epc|licen[cs]e|access|24 ?hours)\b/i;
const SKIP_RE = /\b(messages and calls are end-to-end encrypted|contact card omitted|changed this group's icon|changed the group name|added .* to the group|you're now an admin|advanced chat privacy)\b/i;

function cleanMessage(text = '') {
  return String(text)
    .replace(/\u200e/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashMessage(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function parseWhatsAppDate(datePart, timePart) {
  const [day, month, yearRaw] = datePart.split('/').map(Number);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const [hour, minute, second = 0] = timePart.split(':').map(Number);
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0)).toISOString();
}

function parseWhatsAppExport(text) {
  const lines = String(text || '').split(/\r?\n/);
  const messages = [];
  let current = null;
  const lineRe = /^\u200e?\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?)\]\s+([^:]+):\s?(.*)$/;

  for (const line of lines) {
    const match = line.match(lineRe);
    if (match) {
      if (current) messages.push(current);
      const [, datePart, timePart, sender, content] = match;
      current = {
        occurred_at: parseWhatsAppDate(datePart, timePart),
        sender: cleanMessage(sender),
        content: cleanMessage(content),
        raw: line
      };
    } else if (current && line.trim()) {
      current.content = cleanMessage(`${current.content}\n${line}`);
      current.raw += `\n${line}`;
    }
  }
  if (current) messages.push(current);
  return messages.filter(message => message.content && !SKIP_RE.test(message.content));
}

function inferDomain(content) {
  for (const [domain, regex] of DOMAIN_RULES) {
    if (regex.test(content)) return domain;
  }
  return 'operations';
}

function inferPriority(content) {
  if (/\b(emergency|urgent|asap|must be completed|racing against time)\b/i.test(content)) return 'urgent';
  if (URGENT_RE.test(content)) return 'high';
  return 'medium';
}

function buildTitle(sender, content) {
  const cleaned = cleanMessage(content).replace(/https?:\/\/\S+/g, '[link]');
  const title = cleaned.length > 96 ? `${cleaned.slice(0, 93)}...` : cleaned;
  return `${sender}: ${title}`;
}

function classifyMessage(message) {
  const content = cleanMessage(message.content);
  const domain = inferDomain(content);
  const isAction = ACTION_RE.test(content);
  const isApproval = isAction && APPROVAL_RE.test(content);
  const priority = inferPriority(content);
  const agentKey = AGENT_BY_DOMAIN[domain] || AGENT_BY_DOMAIN.operations;
  const lowerConfidence = /\b(ok|thanks|thank you|cheers|haha|no worries|fab|great)\b/i.test(content) && content.length < 80;

  return {
    should_create_task: isAction,
    should_request_approval: isApproval,
    domain,
    priority,
    agent_key: agentKey,
    confidence: lowerConfidence ? 0.45 : isAction ? 0.82 : 0.58,
    title: buildTitle(message.sender, content),
    summary: content,
    risk_level: isApproval || ['compliance', 'finance', 'utilities'].includes(domain) ? 'high' : 'medium'
  };
}

function buildExternalId(sourceName, message) {
  return hashMessage([sourceName, message.occurred_at || '', message.sender || '', message.content || '']);
}

module.exports = {
  parseWhatsAppExport,
  classifyMessage,
  buildExternalId,
  cleanMessage,
  AGENT_BY_DOMAIN
};
