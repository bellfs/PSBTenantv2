const axios = require('axios');
const { getDb } = require('../database');
const { v4: uuidv4 } = require('uuid');
const { callLLM, analyseImage, runBackendAnalysis } = require('./llm');
const { sendEscalationEmail } = require('./email');
const fs = require('fs');
const path = require('path');

const GRAPH_API_URL = 'https://graph.facebook.com/v21.0'; // v18.0 deprecated Sept 2024

const OLD_ELVET_APARTMENTS = [
  'The Villiers','The Barrington','The Egerton','The Wolsey','The Tunstall','The Montague',
  'The Morton','The Gray','The Langley','The Kirkham','The Fordham','The Talbot Penthouse'
];

const MIN_DIAGNOSIS_ROUNDS = 3;

// Message deduplication cache (prevents duplicate webhook processing)
const processedMessages = new Map();
const DEDUP_TTL = 300000; // 5 minutes

function isDuplicate(messageId) {
  if (!messageId) return false;
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  // Clean old entries
  if (processedMessages.size > 500) {
    const now = Date.now();
    for (const [k, v] of processedMessages) {
      if (now - v > DEDUP_TTL) processedMessages.delete(k);
    }
  }
  return false;
}

async function sendWhatsAppMessage(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    console.log('[WhatsApp] Not configured - would send to', to);
    return { success: true, simulated: true };
  }
  try {
    const r = await axios.post(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp', to, type: 'text', text: { body: text }
    }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    return { success: true, messageId: r.data.messages?.[0]?.id };
  } catch (err) {
    console.error('[WhatsApp] Send error:', err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

async function downloadWhatsAppMedia(mediaId) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  try {
    const urlR = await axios.get(`${GRAPH_API_URL}/${mediaId}`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    const mediaR = await axios.get(urlR.data.url, { headers: { 'Authorization': `Bearer ${accessToken}` }, responseType: 'arraybuffer' });
    return { data: Buffer.from(mediaR.data), mimeType: urlR.data.mime_type };
  } catch (err) { console.error('[WhatsApp] Media download error:', err.message); return null; }
}

async function processIncomingMessage(webhookData) {
  const entry = webhookData.entry?.[0];
  const value = entry?.changes?.[0]?.value;
  if (!value?.messages?.[0]) return;

  const message = value.messages[0];
  const whatsappMessageId = message.id;

  // Deduplicate: WhatsApp sends webhooks multiple times
  if (isDuplicate(whatsappMessageId)) {
    console.log(`[WhatsApp] Skipping duplicate message ${whatsappMessageId}`);
    return;
  }

  const db = getDb();
  try {
    // Also check DB for dedup (in case of server restart)
    if (whatsappMessageId) {
      const existing = db.prepare('SELECT id FROM messages WHERE whatsapp_message_id = ?').get(whatsappMessageId);
      if (existing) {
        console.log(`[WhatsApp] Message ${whatsappMessageId} already in DB, skipping`);
        return;
      }
    }

    const contact = value.contacts?.[0];
    const from = message.from;
    const displayName = contact?.profile?.name || 'Unknown';
    const messageType = message.type;

    console.log(`[WhatsApp] ${messageType} from ${from} (${displayName})`);

    let tenant = db.prepare('SELECT * FROM tenants WHERE phone = ? OR whatsapp_id = ?').get(from, from);
    if (!tenant) {
      tenant = onboardNewTenant(db, from, displayName);
      await sendWhatsAppMessage(from,
        `Hey! 👋 Welcome to PSB Properties maintenance support.\n\nI'm here to help you sort out any issues with your property.\n\nTo get started, could you send me:\n\n1) Your full name\n2) Which property you live at\n3) Your flat or room name/number`
      );
      return;
    }

    if (!tenant.property_id) {
      await handleOnboarding(db, tenant, message, from);
      return;
    }

    let textContent = '';
    let imageData = null;

    if (messageType === 'text') {
      textContent = message.text?.body || '';
    } else if (messageType === 'image') {
      const media = await downloadWhatsAppMedia(message.image.id);
      if (media) {
        const filename = `${uuidv4()}.jpg`;
        const filepath = path.join(__dirname, '..', 'uploads', filename);
        fs.writeFileSync(filepath, media.data);
        imageData = { path: `/uploads/${filename}`, base64: media.data.toString('base64'), mimeType: media.mimeType || 'image/jpeg' };
        textContent = message.image.caption || '[Photo sent]';
      }
    }

    const lowerText = textContent.toLowerCase().trim();

    // Check for "new issue" / "something else" / "yes" (after being asked)
    const wantsNewIssue = lowerText.match(/\b(new issue|new problem|different issue|another problem|something else|yes please|yes i do|yeah|yep)\b/);

    // Check for "no" / "that's all" / "thanks" responses (closing the conversation)
    const wantsNothing = lowerText.match(/\b(no thanks|no thank|nope|that's all|thats all|all good|nothing else|no i'm good|no im good|no that's it|no thats it)\b/);

    // Find any active (non-resolved/closed) issue for this tenant
    let activeIssue = db.prepare(
      "SELECT * FROM issues WHERE tenant_id = ? AND status NOT IN ('resolved','closed') ORDER BY created_at DESC LIMIT 1"
    ).get(tenant.id);

    // Check if the most recent issue was just resolved/escalated (for the "anything else?" flow)
    const lastResolvedIssue = db.prepare(
      "SELECT * FROM issues WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(tenant.id);

    const justCompleted = lastResolvedIssue && ['resolved', 'closed', 'escalated'].includes(lastResolvedIssue.status);
    const lastBotMsg = lastResolvedIssue ? db.prepare(
      "SELECT content FROM messages WHERE issue_id = ? AND sender = 'bot' ORDER BY created_at DESC LIMIT 1"
    ).get(lastResolvedIssue.id) : null;
    const askedAnythingElse = lastBotMsg?.content?.toLowerCase()?.includes('anything else');

    // Handle "anything else?" responses
    if (justCompleted && !activeIssue && askedAnythingElse) {
      if (wantsNothing) {
        await sendWhatsAppMessage(from, `No problem! Glad I could help. Just message me any time if something comes up. 👍`);
        return;
      }
      if (wantsNewIssue || (!wantsNothing && textContent.length > 5)) {
        // They want to report something new, fall through to create new issue
        activeIssue = null;
      }
    }

    // Force new issue if they explicitly ask
    if (wantsNewIssue && activeIssue) {
      activeIssue = null;
    }

    // Create new issue if needed
    if (!activeIssue) {
      // Don't create an issue just for "yes" without context
      if (lowerText.match(/^(yes|yeah|yep|yes please)$/)) {
        await sendWhatsAppMessage(from, `Sure thing! What's the issue? Describe what's going on and I'll help you get it sorted. 🔧`);
        return;
      }

      const issueUuid = uuidv4().slice(0, 8).toUpperCase();
      const result = db.prepare(
        'INSERT INTO issues (uuid, tenant_id, property_id, flat_number, title, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(issueUuid, tenant.id, tenant.property_id, tenant.flat_number, 'New Issue Report', textContent, 'open');
      activeIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(result.lastInsertRowid);
      db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)').run(activeIssue.id, 'created', 'Issue created from WhatsApp', 'system');
    }

    // Save tenant message
    db.prepare('INSERT INTO messages (issue_id, sender, content, message_type, whatsapp_message_id) VALUES (?, ?, ?, ?, ?)').run(
      activeIssue.id, 'tenant', textContent, messageType === 'image' ? 'image' : 'text', whatsappMessageId
    );

    // Handle image attachment and analysis
    if (imageData) {
      const aR = db.prepare('INSERT INTO attachments (issue_id, message_id, file_path, file_type) VALUES (?, ?, ?, ?)').run(
        activeIssue.id, 0, imageData.path, imageData.mimeType
      );
      try {
        const analysis = await analyseImage(imageData.base64, imageData.mimeType, textContent);
        db.prepare('UPDATE attachments SET ai_analysis = ? WHERE id = ?').run(analysis, aR.lastInsertRowid);
        try {
          const parsed = JSON.parse(analysis.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
          if (parsed.category) {
            db.prepare('UPDATE issues SET category = ?, ai_diagnosis = ?, priority = ?, estimated_cost = ?, estimated_hours = ? WHERE id = ?').run(
              parsed.category, parsed.likely_issue, parsed.severity || 'medium',
              parseFloat(parsed.estimated_cost_gbp?.split('-')?.[1]) || 0,
              parseFloat(parsed.estimated_hours?.split('-')?.[1]) || 0,
              activeIssue.id
            );
          }
          if (parsed.safety_concern) {
            const safetyMsg = `I can see something in your photo that could be a safety issue. ${parsed.immediate_action || 'Please make sure you and anyone nearby are safe.'}\n\nI'm passing this straight to our maintenance team now. They'll be in touch very soon. 🚨`;
            await sendWhatsAppMessage(from, safetyMsg);
            db.prepare('INSERT INTO messages (issue_id, sender, content, message_type) VALUES (?, ?, ?, ?)').run(activeIssue.id, 'bot', safetyMsg, 'text');
            await escalateIssue(db, activeIssue, tenant, 'Safety concern identified from photo');
            // Ask if anything else
            const followUp = `\n📋 Your reference: ${activeIssue.uuid}\n\nIs there anything else you need help with?`;
            await sendWhatsAppMessage(from, followUp);
            db.prepare('INSERT INTO messages (issue_id, sender, content, message_type) VALUES (?, ?, ?, ?)').run(activeIssue.id, 'bot', followUp, 'text');
            return;
          }
        } catch (e) {}
      } catch (err) { console.error('[AI] Image analysis error:', err.message); }
    }

    // Get conversation history
    const conversationMessages = db.prepare('SELECT sender, content, message_type FROM messages WHERE issue_id = ? ORDER BY created_at ASC').all(activeIssue.id);
    const llmMessages = conversationMessages.map(m => ({ role: m.sender === 'tenant' ? 'user' : 'assistant', content: m.content || '[photo sent]' }));
    const botMessages = conversationMessages.filter(m => m.sender === 'bot');
    const diagnosisRound = botMessages.length;
    const hasPhotos = conversationMessages.some(m => m.message_type === 'image');

    const escalationThreshold = parseInt(db.prepare('SELECT value FROM settings WHERE key = ?').get('escalation_threshold')?.value || '6');
    const property = tenant.property_id ? db.prepare('SELECT name FROM properties WHERE id = ?').get(tenant.property_id) : null;

    // Auto-escalate if we've been going too long
    if (diagnosisRound >= escalationThreshold) {
      const msg = `Thanks for bearing with me, ${tenant.name?.split(' ')[0] || ''}. I think this one needs our maintenance team to come and have a look in person.\n\nI've passed over everything you've told me and the photos. They'll review it and be in touch.\n\n📋 Your reference: ${activeIssue.uuid}\n\nIs there anything else you need help with?`;
      await sendWhatsAppMessage(from, msg);
      db.prepare('INSERT INTO messages (issue_id, sender, content, message_type) VALUES (?, ?, ?, ?)').run(activeIssue.id, 'bot', msg, 'text');
      await escalateIssue(db, activeIssue, tenant);
      return;
    }

    // Build LLM context
    let additionalContext = `\n\nCONVERSATION CONTEXT:
- Tenant first name: ${tenant.name?.split(' ')[0] || 'there'}
- Property: ${property?.name || 'Unknown'}
- Flat: ${tenant.flat_number || 'Not specified'}
- Issue ref: ${activeIssue.uuid}
- Photos received: ${hasPhotos ? 'yes' : 'no'}
- Current diagnosis round: ${diagnosisRound + 1}
- Minimum rounds before suggesting fix: ${MIN_DIAGNOSIS_ROUNDS}`;

    if (diagnosisRound < MIN_DIAGNOSIS_ROUNDS) {
      additionalContext += `\n\nIMPORTANT: This is diagnosis round ${diagnosisRound + 1} of minimum ${MIN_DIAGNOSIS_ROUNDS}.
DO NOT suggest a fix yet. DO NOT mention costs, time estimates, or difficulty to the tenant.
Focus on asking smart diagnostic questions and requesting specific photos.
${!hasPhotos ? 'The tenant has NOT sent any photos yet. Ask for one from a specific angle.' : 'Photos received. Ask follow-up questions based on what you can gather from the conversation.'}
${diagnosisRound === 0 ? 'This is the FIRST response. Acknowledge their issue, ask 2-3 specific diagnostic questions, and ask for a photo.' : ''}
${diagnosisRound === 1 ? 'This is round 2. Dig deeper. Ask about how long, whether it is getting worse, and any other relevant details.' : ''}
${diagnosisRound === 2 ? 'This is round 3. Ask any final clarifying questions. Confirm your understanding.' : ''}`;
    } else {
      additionalContext += `\n\nYou have completed ${diagnosisRound} rounds of diagnosis. You may now suggest a fix IF:
- The issue is something the tenant can safely handle themselves
- You are confident in your diagnosis

If the issue is serious, structural, electrical, gas-related, or the tenant seems uncomfortable, say you are passing it to the maintenance team instead and include their reference number: ${activeIssue.uuid}

When suggesting a fix:
- Write simple numbered steps using 1) 2) 3) format (NOT 1. 2. 3.)
- Include a YouTube search results link: https://www.youtube.com/results?search_query=relevant+terms+here (replace spaces with +)
- Include a forum search link: https://www.google.com/search?q=site:reddit.com+OR+site:diynot.com+OR+site:screwfix.com+relevant+terms+here
- Mention where to buy materials (B&Q, Screwfix) and approximate cost
- At the END of your message, always ask: "Let me know how you get on, or if there's anything else I can help with!"

If escalating instead, end with: "Is there anything else you need help with?"`;
    }

    try {
      const aiResponse = await callLLM(llmMessages, { additionalContext });
      db.prepare('INSERT INTO messages (issue_id, sender, content, message_type) VALUES (?, ?, ?, ?)').run(activeIssue.id, 'bot', aiResponse, 'text');

      // Check if the AI decided to escalate
      const aiEscalated = aiResponse.toLowerCase().includes('passing') && aiResponse.toLowerCase().includes('team');
      if (aiEscalated && diagnosisRound >= MIN_DIAGNOSIS_ROUNDS) {
        await escalateIssue(db, activeIssue, tenant, 'AI determined professional needed');
      }

      // Update title if still generic
      if (activeIssue.title === 'New Issue Report' && textContent && textContent !== '[Photo sent]') {
        try {
          const title = await callLLM(
            [{ role: 'user', content: `Summarise this maintenance issue in 5-8 words as a short title. No quotes, no punctuation, just the title: "${textContent}"` }],
            { maxTokens: 50 }
          );
          db.prepare('UPDATE issues SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title.replace(/"/g, '').replace(/\n/g, '').trim().slice(0, 60), activeIssue.id);
        } catch (e) {}
      }

      // Run silent backend analysis for the team
      if (diagnosisRound === 0 || (diagnosisRound > 0 && diagnosisRound % 2 === 0)) {
        runBackendAnalysis(activeIssue.id, conversationMessages).catch(e => console.error('[Backend] Analysis failed:', e.message));
      }

      await sendWhatsAppMessage(from, aiResponse);
    } catch (err) {
      console.error('[AI] Response error:', err.message);
      await sendWhatsAppMessage(from, `Sorry, I'm having a bit of trouble right now. Your issue has been logged and our team will be in touch.\n\n📋 Reference: ${activeIssue.uuid}`);
      await escalateIssue(db, activeIssue, tenant, 'AI service error');
    }
  } catch (err) {
    console.error('[WhatsApp] Processing error:', err);
  } finally {
    db.close();
  }
}

function onboardNewTenant(db, phone, displayName) {
  const result = db.prepare('INSERT INTO tenants (name, phone, whatsapp_id) VALUES (?, ?, ?)').run(displayName || 'New Tenant', phone, phone);
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(result.lastInsertRowid);
}

async function handleOnboarding(db, tenant, message, from) {
  if (message.type !== 'text') {
    await sendWhatsAppMessage(from, 'Thanks! But I just need a few details first. Could you tell me your name, which property you live at, and your flat or room?');
    return;
  }
  const text = message.text?.body || '';
  try {
    const extractPrompt = `Extract tenant registration details from this message.

Our properties in Durham:
- 52 Old Elvet (apartments: ${OLD_ELVET_APARTMENTS.join(', ')})
- 33 Old Elvet, Flass Court 2A, Flass Court 2B, Flass Court Lower, Flass House Upper, Flass House Lower
- Claypath Flat 1, Claypath Flat 2, Claypath Flat 3, Claypath Flat 4
- 35 St Andrews Court, 7 Cathedrals, 2 St Margarets Mews, 24 Hallgarth Street

RULES:
- Accept whatever name they give
- Match property with fuzzy matching (e.g. "Old Elvet" = "52 Old Elvet", "Claypath" = Claypath Flat, "Hallgarth" = "24 Hallgarth Street")
- For 52 Old Elvet, match apartment names (e.g. "Egerton" = "The Egerton")

Message: "${text}"

Respond ONLY with JSON: {"name":"their name or null","property_name":"matched property or null","flat_number":"flat/apartment or null"}`;

    const result = await callLLM([{ role: 'user', content: extractPrompt }], { maxTokens: 200, additionalContext: '\nRespond ONLY with valid JSON.' });
    let cleaned = result.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e !== -1) cleaned = cleaned.substring(s, e + 1);
    const parsed = JSON.parse(cleaned);

    if (parsed.name && parsed.name !== 'null') db.prepare('UPDATE tenants SET name = ? WHERE id = ?').run(parsed.name, tenant.id);

    if (parsed.property_name && parsed.property_name !== 'null') {
      let property = db.prepare('SELECT id, name FROM properties WHERE LOWER(name) = LOWER(?)').get(parsed.property_name);
      if (!property) property = db.prepare('SELECT id, name FROM properties WHERE LOWER(name) LIKE LOWER(?)').get(`%${parsed.property_name}%`);
      if (!property) {
        for (const word of parsed.property_name.toLowerCase().split(/\s+/)) {
          if (word.length > 3) { property = db.prepare('SELECT id, name FROM properties WHERE LOWER(name) LIKE LOWER(?)').get(`%${word}%`); if (property) break; }
        }
      }
      if (property) {
        const flat = (parsed.flat_number && parsed.flat_number !== 'null') ? parsed.flat_number : '';
        db.prepare('UPDATE tenants SET property_id = ?, flat_number = ? WHERE id = ?').run(property.id, flat, tenant.id);
        const name = parsed.name || tenant.name || '';
        await sendWhatsAppMessage(from, `Great, thanks ${name}! I've got you down at ${property.name}${flat ? ', ' + flat : ''}.\n\nYou can report maintenance issues to me any time. Just describe what's going on and send some photos if you can. 🔧`);
        return;
      }
    }

    if (parsed.name && parsed.name !== 'null') {
      await sendWhatsAppMessage(from, `Thanks ${parsed.name}! I couldn't quite match your property. Which of these do you live at?\n\n- 52 Old Elvet\n- 33 Old Elvet\n- Flass Court 2A / 2B\n- Flass House Upper / Lower\n- Claypath Flat 1 / 2 / 3 / 4\n- 35 St Andrews Court\n- 7 Cathedrals\n- 2 St Margarets Mews\n- 24 Hallgarth Street\n\nAnd your flat or room name?`);
    } else {
      await sendWhatsAppMessage(from, `No worries! Could you tell me:\n\n1) Your full name\n2) Which property you live at\n3) Your flat or room name/number`);
    }
  } catch (err) {
    console.error('[Onboarding] Error:', err.message);
    await sendWhatsAppMessage(from, 'Sorry, had a little trouble there. Could you tell me:\n\n1) Your full name\n2) Which property you live at\n3) Your flat or room name/number');
  }
}

async function escalateIssue(db, issue, tenant, reason = 'Exceeded AI triage attempts') {
  db.prepare("UPDATE issues SET status = 'escalated', escalated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(issue.id);
  db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)').run(issue.id, 'escalated', reason, 'system');
  const messages = db.prepare('SELECT * FROM messages WHERE issue_id = ? ORDER BY created_at ASC').all(issue.id);
  const attachments = db.prepare('SELECT * FROM attachments WHERE issue_id = ?').all(issue.id);
  const property = issue.property_id ? db.prepare('SELECT * FROM properties WHERE id = ?').get(issue.property_id) : null;
  try { await runBackendAnalysis(issue.id, messages); } catch (e) {}
  try { await sendEscalationEmail({ issue, tenant, property, messages, attachments, reason }); } catch (err) { console.error('[Email] Failed:', err.message); }
}

async function sendStaffResponse(issueId, staffName, responseText) {
  const db = getDb();
  try {
    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId);
    if (!issue) throw new Error('Issue not found');
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(issue.tenant_id);
    if (!tenant) throw new Error('Tenant not found');
    db.prepare('INSERT INTO messages (issue_id, sender, content, message_type) VALUES (?, ?, ?, ?)').run(issueId, 'staff', responseText, 'text');
    db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)').run(issueId, 'staff_response', 'Manual response', staffName);
    await sendWhatsAppMessage(tenant.phone, `PSB Properties Team (${staffName}):\n\n${responseText}`);
    return { success: true };
  } finally { db.close(); }
}

module.exports = { processIncomingMessage, sendWhatsAppMessage, sendStaffResponse, downloadWhatsAppMedia };
