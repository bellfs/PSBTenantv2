const axios = require('axios');
const { getDb } = require('../database');

function getSettings() {
  try {
    const db = getDb(); const rows = db.prepare('SELECT key, value FROM settings').all(); db.close();
    const s = {}; for (const r of rows) s[r.key] = r.value; return s;
  } catch (err) { return {}; }
}

function resolveProvider(settings) {
  return process.env.LLM_PROVIDER || settings.llm_provider || 'openai';
}

function resolveApiKey(provider, settings) {
  if (provider === 'openai') {
    const k = process.env.OPENAI_API_KEY || settings.openai_api_key;
    return (k && k.length > 10) ? k : null;
  }
  const k = process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key;
  return (k && k.length > 10) ? k : null;
}

function getProviderAndKey() {
  const settings = getSettings();
  let provider = resolveProvider(settings);
  let key = resolveApiKey(provider, settings);
  if (!key) {
    const fb = provider === 'openai' ? 'anthropic' : 'openai';
    const fk = resolveApiKey(fb, settings);
    if (fk) { provider = fb; key = fk; }
  }
  if (!key) throw new Error('No LLM API key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in Railway env vars.');
  return { provider, key };
}

// ============================================================
// SYSTEM PROMPT - Multi-step expert diagnosis for WhatsApp
// ============================================================
const SYSTEM_PROMPT = `You are the PSB Properties maintenance assistant, helping student tenants in Durham diagnose property issues via WhatsApp.

FORMATTING RULES (CRITICAL - READ CAREFULLY):
- NEVER use markdown. No #, ##, ###, **, *, -, bullet points, or numbered lists with periods.
- Write in plain conversational English as short WhatsApp messages.
- Use emojis sparingly (1-3 per message max). Never stack emojis.
- Keep messages SHORT. Under 200 words ideally. Students won't read essays.
- Write like a friendly expert contractor texting a client. Warm but professional.
- Use line breaks between thoughts, not formatting characters.

YOUR ROLE:
You are an expert property maintenance contractor diagnosing issues remotely via WhatsApp. You need to fully understand the problem before suggesting anything. Think like a plumber, electrician, or builder who needs to see the issue properly before quoting.

DIAGNOSIS APPROACH (MULTI-STEP - THIS IS CRITICAL):
You MUST ask focused diagnostic questions across MULTIPLE messages before ever suggesting a fix.

Round 1 (first response to a new issue):
- Acknowledge what they've described
- Ask 2-3 simple, specific questions to narrow down the problem
- Ask for a photo of the specific area (be specific about what angle/view you need)
- Do NOT estimate costs, time, difficulty, or suggest any fix yet

Round 2 (after their first reply/photo):
- If they sent a photo, analyse it and ask follow-up questions about what you can see
- If no photo, ask again for one from a specific angle
- Ask about duration (how long has this been happening?), severity (is it getting worse?), and impact (is it affecting daily life?)
- Still do NOT suggest a fix yet

Round 3 (after their second reply):
- Ask any final clarifying questions
- If you now have enough information, confirm your understanding of the full picture
- Still hold off on the fix unless you're very confident in the diagnosis

Round 4+ (after 3+ rounds of questions):
- NOW you can offer a suggested fix if it's something they can handle themselves
- If the issue is serious (structural, electrical, gas, significant water damage, anything safety-related), DO NOT suggest a DIY fix. Instead say you're passing it to the maintenance team.
- When suggesting a fix, include a specific YouTube video URL and a relevant forum link (see below)

ASKING FOR PHOTOS:
Be specific about what you need to see. Examples:
- "Could you send me a close-up photo of where the rot is worst?"
- "Can you take a photo from about a metre back so I can see the full window frame?"
- "Could you photograph the area underneath as well? I want to check if water is pooling there."
- "Can you press your finger against it and photograph how soft the wood is?"

WHEN PHOTOS ARRIVE:
- Comment on what you can see specifically
- Point out things you've noticed ("I can see the sealant has cracked along the top edge")
- Ask targeted follow-ups based on what the photo reveals
- If the photo isn't clear enough, ask for a better angle

SUGGESTED FIX FORMAT (only after 3+ rounds):
Write it as a simple step-by-step in plain text. No markdown. Number steps like "1)" not "1." to avoid WhatsApp formatting. Keep each step to one sentence. Example:

Here's what I'd suggest:

1) Turn off the water supply under the sink (the valve on the left pipe)
2) Place a towel underneath to catch any drips
3) Unscrew the connector ring by hand, turning anticlockwise
4) Check the washer inside, it's probably worn or split
5) Pop to B&Q or Screwfix and grab a replacement washer (about £2)
6) Fit the new one and tighten back up

Here's a video that walks through it:
https://www.youtube.com/results?search_query=how+to+replace+tap+washer+uk

And this thread has some good tips from people who've done it:
https://www.google.com/search?q=site:reddit.com+OR+site:diynot.com+replace+tap+washer+tips

YOUTUBE AND FORUM LINKS:
- For YouTube, provide a YouTube search results URL: https://www.youtube.com/results?search_query=your+search+terms+here
- For forums, provide a Google search URL filtered to DIY sites: https://www.google.com/search?q=site:reddit.com+OR+site:diynot.com+OR+site:screwfix.com+your+search+terms
- Only include these links in the final fix suggestion, NOT during diagnosis rounds
- Make the search terms specific to the exact issue diagnosed

ESCALATION:
If any of these apply, do NOT suggest a DIY fix. Instead tell the tenant you're passing it to the team:
- Gas related (any gas smell, boiler issues beyond simple reset)
- Electrical (exposed wires, burning smell, sparking, full circuit issues)
- Structural (cracks in walls, sagging ceiling, major water damage)
- Significant mould covering large area
- Anything where a wrong DIY attempt could make it worse or be dangerous
- Tenant has tried the suggested fix and it didn't work
- Tenant says they're not comfortable doing it themselves

When escalating, be reassuring: "This one's best handled by our maintenance team. I'll pass everything over to them now with all the details and photos you've sent. They'll be in touch soon."

SAFETY:
- Gas smell: Tell them to open windows, don't use switches, call National Gas Emergency 0800 111 999
- Flooding: Tell them to turn off stopcock and electricity if water near electrics, call 999 if severe
- Fire: Call 999 immediately
- Always prioritise safety over diagnosis

TONE:
- Friendly but competent. Like a knowledgeable mate who happens to be a builder.
- Don't be over the top with enthusiasm or emojis
- Don't say "you've got this!" or "you're a star!" - just be helpful and practical
- Use their first name naturally`;

// ============================================================
// Backend-only analysis prompt (team dashboard, not sent to tenant)
// ============================================================
const BACKEND_ANALYSIS_PROMPT = `You are analysing a property maintenance conversation between a tenant and an AI assistant. Based on the conversation so far, provide a professional assessment for the property management team.

Respond ONLY with JSON, no other text:
{
  "likely_issue": "Brief description of what the problem most likely is",
  "confidence": "low|medium|high",
  "difficulty": "easy|medium|hard|professional_required",
  "estimated_cost_min": 0,
  "estimated_cost_max": 0,
  "estimated_hours_min": 0,
  "estimated_hours_max": 0,
  "needs_professional": false,
  "category": "plumbing|electrical|heating|appliance|structural|pest|damp_mould|locks_security|windows_doors|other",
  "priority": "low|medium|high|urgent",
  "summary_for_team": "2-3 sentence summary of the issue and current diagnosis status for the maintenance team"
}

Use GBP for costs. Be realistic for UK prices.`;


async function callLLM(messages, options = {}) {
  const { provider, key } = getProviderAndKey();
  console.log(`[LLM] Using ${provider}`);
  return provider === 'anthropic' ? callAnthropic(messages, key, options) : callOpenAI(messages, key, options);
}

async function callAnthropic(messages, apiKey, options = {}) {
  const msgs = messages.map(m => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })).filter(m => m.role !== 'system');
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: options.model || 'claude-sonnet-4-20250514', max_tokens: options.maxTokens || 1024,
    system: (options.systemPrompt || SYSTEM_PROMPT) + (options.additionalContext || ''), messages: msgs
  }, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 30000 });
  return response.data.content[0].text;
}

async function callOpenAI(messages, apiKey, options = {}) {
  const sys = (options.systemPrompt || SYSTEM_PROMPT) + (options.additionalContext || '');
  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: options.model || 'gpt-4o-mini', messages: [{ role: 'system', content: sys }, ...messages],
    max_tokens: options.maxTokens || 1024, temperature: 0.7
  }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 });
  return response.data.choices[0].message.content;
}

async function analyseImage(imageBase64, mimeType, context = '') {
  const { provider, key } = getProviderAndKey();
  const prompt = `Analyse this property maintenance image. ${context ? 'Tenant says: ' + context : ''}

Respond ONLY with JSON:
{"description":"what you see in detail","likely_issue":"the probable problem","severity":"low|medium|high|urgent","category":"plumbing|electrical|heating|appliance|structural|pest|damp_mould|locks_security|windows_doors|other","immediate_action":"any immediate steps needed","can_self_fix":true,"safety_concern":false,"estimated_cost_gbp":"10-30","estimated_hours":"0.5-1","follow_up_questions":["specific question about what I see in the photo","another targeted question"]}`;

  if (provider === 'anthropic') {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514', max_tokens: 1024,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } }, { type: 'text', text: prompt }] }]
    }, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 30000 });
    return r.data.content[0].text;
  }
  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini', max_tokens: 1024,
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }, { type: 'text', text: prompt }] }]
  }, { headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 30000 });
  return r.data.choices[0].message.content;
}

// ============================================================
// Backend analysis - runs silently, updates issue for team view
// ============================================================
async function runBackendAnalysis(issueId, conversationMessages) {
  try {
    const conversationText = conversationMessages.map(m => {
      const role = m.sender === 'tenant' ? 'Tenant' : 'Assistant';
      return `${role}: ${m.content || '[photo]'}`;
    }).join('\n');

    const result = await callLLM(
      [{ role: 'user', content: `Analyse this maintenance conversation:\n\n${conversationText}` }],
      { systemPrompt: BACKEND_ANALYSIS_PROMPT, maxTokens: 500 }
    );

    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;

    const parsed = JSON.parse(cleaned.substring(start, end + 1));

    const db = getDb();
    try {
      db.prepare(`UPDATE issues SET 
        category = COALESCE(?, category),
        ai_diagnosis = ?,
        priority = COALESCE(?, priority),
        estimated_cost = ?,
        estimated_hours = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(
        parsed.category || null,
        parsed.summary_for_team || parsed.likely_issue || null,
        parsed.priority || null,
        ((parsed.estimated_cost_min || 0) + (parsed.estimated_cost_max || 0)) / 2,
        ((parsed.estimated_hours_min || 0) + (parsed.estimated_hours_max || 0)) / 2,
        issueId
      );
    } finally { db.close(); }

    console.log(`[Backend Analysis] Issue ${issueId}: ${parsed.likely_issue} (${parsed.difficulty}, ${parsed.priority})`);
    return parsed;
  } catch (err) {
    console.error('[Backend Analysis] Error:', err.message);
    return null;
  }
}

async function estimateCosts(issueDescription, category) {
  const prompt = `You are a UK property maintenance cost estimator. Based on this issue, provide cost and time estimates.

Issue: ${issueDescription}
Category: ${category || 'unknown'}

Respond ONLY with JSON, no other text:
{"estimated_cost_min":0,"estimated_cost_max":0,"estimated_hours_min":0,"estimated_hours_max":0,"materials":["list","of","materials"],"needs_professional":false,"professional_cost_min":0,"professional_cost_max":0}

Use GBP. Be realistic for UK prices.`;

  try {
    const result = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 300, additionalContext: '\nRespond ONLY with valid JSON.' });
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) return JSON.parse(cleaned.substring(start, end + 1));
  } catch (e) { console.error('[LLM] Cost estimation error:', e.message); }
  return null;
}

module.exports = { callLLM, analyseImage, estimateCosts, runBackendAnalysis, getSettings, SYSTEM_PROMPT };
