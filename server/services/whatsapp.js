const axios = require('axios');
const { getDb } = require('../database');
const { v4: uuidv4 } = require('uuid');
const { callLLM, analyseImage, runBackendAnalysis } = require('./llm');
const { sendEscalationEmail, sendNewIssueEmail } = require('./email');
const fs = require('fs');
const path = require('path');

const GRAPH_API_URL = 'https://graph.facebook.com/v22.0';

const OLD_ELVET_APARTMENTS = [
  'The Villiers','The Barrington','The Egerton','The Wolsey','The Tunstall','The Montague',
  'The Morton','The Gray','The Langley','The Kirkham','The Fordham','The Talbot Penthouse'
];

const MIN_DIAGNOSIS_ROUNDS = 3;
const CONVERSATION_GAP_MS = 10 * 60 * 60 * 1000; // 10 hours

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
    const errorDetail = err.response?.data?.error || err.response?.data || err.message;
    console.error('[WhatsApp] Send error:', JSON.stringify(errorDetail));
    if (err.response?.status === 401 || err.response?.status === 190) {
      console.error('[WhatsApp] ACCESS TOKEN EXPIRED OR INVALID. Generate a new permanent token from Meta Business Manager.');
    }
    if (err.response?.status === 400) {
      console.error('[WhatsApp] Bad request - check phone number format (must include country code, no + prefix)');
    }
    return { success: false, error: err.message, details: errorDetail };
  }
}

async function downloadWhatsAppMedia(mediaId) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  try {
    const urlR = await axios.get(`${GRAPH_API_URL}/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      timeout: 15000
    });
    const mediaR = await axios.get(urlR.data.url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      responseType: 'arraybuffer',
      timeout: 30000
    });
    return { data: Buffer.from(mediaR.data), mimeType: urlR.data.mime_type };
  } catch (err) {
    console.error('[WhatsApp] Media download error:', err.message);
    if (err.code === 'ECONNABORTED') console.error('[WhatsApp] Media download TIMED OUT for mediaId:', mediaId);
    return null;
  }
}

// ============================================================
// AI-powered intent classification for returning tenants
// ============================================================
async function classifyTenantIntent(textContent, activeIssue, lastMessages) {
  const recentConvo = lastMessages.slice(-6).map(m =>
    `${m.sender === 'tenant' ? 'Tenant' : 'Bot'}: ${(m.content || '').slice(0, 150)}`
  ).join('\n');

  const prompt = `You are classifying a tenant's WhatsApp message to a property maintenance bot.

EXISTING OPEN ISSUE:
- Title: ${activeIssue.title}
- Category: ${activeIssue.category || 'unknown'}
- Status: ${activeIssue.status}
- AI Diagnosis: ${(activeIssue.ai_diagnosis || '').slice(0, 200)}

RECENT CONVERSATION ON THIS ISSUE:
${recentConvo}

NEW MESSAGE FROM TENANT:
"${textContent}"

Is this message:
A) Continuing the SAME issue (providing more info, answering questions, following up, asking about their reference number, asking for status)
B) Reporting a COMPLETELY DIFFERENT new maintenance problem (e.g. different room, different type of issue entirely)

Consider: tenants often take time to respond. A delayed reply about the same topic is NOT a new issue. Only classify as B if the message clearly describes a different physical problem.

Respond ONLY with JSON: {"intent": "existing" or "new", "reason": "brief explanation"}`;

  try {
    const result = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 100 });
    const cleaned = result.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e !== -1) {
      const parsed = JSON.parse(cleaned.substring(s, e + 1));
      console.log(`[Intent] Classified as "${parsed.intent}": ${parsed.reason}`);
      return parsed.intent === 'new' ? 'new' : 'existing';
    }
  } catch (err) {
    console.error('[Intent] Classification failed:', err.message);
  }
  return 'existing'; // Default to continuing existing issue
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

    // Detect small talk / niceties that should NOT create a new issue
    const isSmallTalk = !imageData && lowerText.match(/^(thanks|thank you|cheers|ta|thx|thank u|nice one|brilliant|great|perfect|lovely|cool|awesome|fab|amazing|good one|sweet|wicked|class|mint|sound|safe|legend|brill|no worries|no problem|np|all good|sorted|how are you|how r u|hows it going|how's it going|whats up|what's up|hey|hi|hello|hiya|yo|morning|good morning|afternoon|evening|good evening|goodnight|night|haha|lol|lmao|😂|👍|🙏|❤️|okay|ok|sure|right|fair enough|got it|understood|will do|nice|good|great thanks|thanks mate|cheers mate|thanks a lot|thank you so much|much appreciated|appreciate it)$/);

    // Only match EXPLICIT new issue phrases (not casual affirmations)
    const explicitNewIssue = lowerText.match(/\b(new issue|new problem|different issue|another problem|something else|report something new)\b/);

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
      if (wantsNothing || isSmallTalk) {
        await sendWhatsAppMessage(from, `No problem! Glad I could help. Just message me any time if something comes up. 👍`);
        return;
      }
      // They want to report something new - fall through to create new issue
      activeIssue = null;
    }

    // Handle small talk when there's NO active issue — respond pleasantly without creating an issue
    if (isSmallTalk && !activeIssue) {
      const firstName = tenant.name?.split(' ')[0] || 'there';
      const greetings = lowerText.match(/^(hey|hi|hello|hiya|yo|morning|good morning|afternoon|evening|good evening)$/);
      const howAreYou = lowerText.match(/^(how are you|how r u|hows it going|how's it going|whats up|what's up)$/);

      let response;
      if (greetings) {
        response = `Hey ${firstName}! 👋 Good to hear from you. Got a maintenance issue I can help with, or just checking in?`;
      } else if (howAreYou) {
        response = `All good here thanks ${firstName}! Ready and waiting to help if anything needs sorting in your flat. What can I do for you? 🔧`;
      } else {
        response = `You're welcome ${firstName}! If anything comes up around the flat, just drop me a message any time. 👍`;
      }
      await sendWhatsAppMessage(from, response);
      return;
    }

    // ============================================================
    // 10-hour gap detection: if tenant hasn't messaged in 10+ hours
    // on an active issue, ask whether this is the same issue or new
    // ============================================================
    if (activeIssue && !explicitNewIssue) {
      const lastTenantMsg = db.prepare(
        "SELECT created_at FROM messages WHERE issue_id = ? AND sender = 'tenant' ORDER BY created_at DESC LIMIT 1 OFFSET 0"
      ).get(activeIssue.id);

      // Check the last message from ANYONE on this issue (to detect the gap properly)
      const lastAnyMsg = db.prepare(
        "SELECT created_at FROM messages WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(activeIssue.id);

      if (lastAnyMsg) {
        const gapMs = Date.now() - new Date(lastAnyMsg.created_at).getTime();
        const isReturningAfterGap = gapMs > CONVERSATION_GAP_MS;

        if (isReturningAfterGap) {
          console.log(`[WhatsApp] Tenant returning after ${Math.round(gapMs / 3600000)}h gap on issue ${activeIssue.uuid}`);

          // Use AI to classify: is this about the existing issue or something new?
          const lastMessages = db.prepare(
            "SELECT sender, content FROM messages WHERE issue_id = ? ORDER BY created_at DESC LIMIT 6"
          ).all(activeIssue.id).reverse();

          const intent = await classifyTenantIntent(textContent, activeIssue, lastMessages);

          if (intent === 'new') {
            // AI says this is a different issue — ask to confirm before creating
            const confirmMsg = `Hey ${tenant.name?.split(' ')[0] || 'there'}! I can see you have an open issue:\n\n📋 *${activeIssue.title}* (Ref: ${activeIssue.uuid})\n\nIt sounds like you might be reporting something new. Is this a *new issue*, or are you following up on the one above?`;
            await sendWhatsAppMessage(from, confirmMsg);
            // Save their message and bot's question to the existing issue for now
            db.prepare('INSERT INTO messages (issue_id, sender, content, message_type, whatsapp_message_id) VALUES (?, ?, ?, ?, ?)').run(
              activeIssue.id, 'tenant', textContent, messageType === 'image' ? 'image' : 'text', whatsappMessageId
            );
            db.prepare('INSERT INTO messages (issue_id, sender, content, message_type) VALUES (?, ?, ?, ?)').run(
              activeIssue.id, 'bot', confirmMsg, 'text'
            );
            return;
          }
          // intent === 'existing': continue with this issue (fall through)
        }
      }
    }

    // Force new issue ONLY if they explicitly ask with clear phrases
    if (explicitNewIssue && activeIssue) {
      activeIssue = null;
    }

    // Create new issue if needed
    if (!activeIssue) {
      // Don't create an issue just for short affirmations without context
      if (lowerText.match(/^(yes|yeah|yep|yes please|yea|ok|okay)$/)) {
        await sendWhatsAppMessage(from, `Sure thing! What's the issue? Describe what's going on and I'll help you get it sorted. 🔧`);
        return;
      }

      // For ambiguous short messages from tenants with prior history, ask for clarification
      if (textContent.length < 15 && lastResolvedIssue && !explicitNewIssue) {
        const recentIssueAge = Date.now() - new Date(lastResolvedIssue.updated_at).getTime();
        if (recentIssueAge < 7 * 24 * 60 * 60 * 1000) { // within last 7 days
          await sendWhatsAppMessage(from, `Hey ${tenant.name?.split(' ')[0] || 'there'}! Are you following up on your previous issue (${lastResolvedIssue.title}, Ref: ${lastResolvedIssue.uuid}), or do you need to report something new?`);
          return;
        }
      }

      const issueUuid = uuidv4().slice(0, 8).toUpperCase();
      const result = db.prepare(
        'INSERT INTO issues (uuid, tenant_id, property_id, flat_number, title, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(issueUuid, tenant.id, tenant.property_id, tenant.flat_number, 'New Issue Report', textContent, 'open');
      activeIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(result.lastInsertRowid);
      db.prepare('INSERT INTO activity_log (issue_id, action, details, performed_by) VALUES (?, ?, ?, ?)').run(activeIssue.id, 'created', 'Issue created from WhatsApp', 'system');
    }

    // Save tenant message
    const msgResult = db.prepare('INSERT INTO messages (issue_id, sender, content, message_type, whatsapp_message_id) VALUES (?, ?, ?, ?, ?)').run(
      activeIssue.id, 'tenant', textContent, messageType === 'image' ? 'image' : 'text', whatsappMessageId
    );
    const savedMessageId = msgResult.lastInsertRowid;

    // Handle image attachment and analysis
    if (imageData) {
      const aR = db.prepare('INSERT INTO attachments (issue_id, message_id, file_path, file_type) VALUES (?, ?, ?, ?)').run(
        activeIssue.id, savedMessageId, imageData.path, imageData.mimeType
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

    // Capture issue ID and tenant/property info for async email callback
    const issueId = activeIssue.id;
    const tenantForEmail = { ...tenant };
    const propertyForEmail = property ? { ...property } : null;

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
        runBackendAnalysis(issueId, conversationMessages)
          .then(() => {
            // Send new issue email after first backend analysis completes
            if (diagnosisRound === 0) {
              // Use a fresh DB connection since the outer one is closed by now
              const emailDb = getDb();
              try {
                const freshIssue = emailDb.prepare('SELECT * FROM issues WHERE id = ?').get(issueId);
                const issueMessages = emailDb.prepare('SELECT * FROM messages WHERE issue_id = ? ORDER BY created_at ASC').all(issueId);
                const issueAttachments = emailDb.prepare('SELECT * FROM attachments WHERE issue_id = ?').all(issueId);
                sendNewIssueEmail({ issue: freshIssue, tenant: tenantForEmail, property: propertyForEmail, messages: issueMessages, attachments: issueAttachments })
                  .catch(e => console.error('[Email] New issue email failed:', e.message));
              } finally {
                emailDb.close();
              }
            }
          })
          .catch(e => {
            console.error('[Backend] Analysis failed:', e.message);
            // Still send new issue email even if analysis fails
            if (diagnosisRound === 0) {
              const emailDb = getDb();
              try {
                const issueMessages = emailDb.prepare('SELECT * FROM messages WHERE issue_id = ? ORDER BY created_at ASC').all(issueId);
                const issueAttachments = emailDb.prepare('SELECT * FROM attachments WHERE issue_id = ?').all(issueId);
                sendNewIssueEmail({ issue: activeIssue, tenant: tenantForEmail, property: propertyForEmail, messages: issueMessages, attachments: issueAttachments })
                  .catch(e2 => console.error('[Email] New issue email failed:', e2.message));
              } finally {
                emailDb.close();
              }
            }
          });
      }

      await sendWhatsAppMessage(from, aiResponse);

      // Notify staff of new tenant message (async, non-blocking)
      notifyStaff(tenant.name || displayName, property?.name, activeIssue.title, activeIssue.id, activeIssue.uuid, textContent);
    } catch (err) {
      console.error('[AI] Response error:', err.message);
      await sendWhatsAppMessage(from, `Sorry, I'm having a bit of trouble right now. Your issue has been logged and our team will be in touch.\n\n📋 Reference: ${activeIssue.uuid}`);
      await escalateIssue(db, activeIssue, tenant, 'AI service error');
    }
  } catch (err) {
    console.error('[WhatsApp] Processing error:', err);
    try {
      db.prepare('INSERT INTO activity_log (action, details, performed_by) VALUES (?, ?, ?)').run(
        'message_processing_error',
        `Error: ${err.message} | Stack: ${(err.stack || '').slice(0, 400)}`,
        'system'
      );
    } catch (logErr) { console.error('[WhatsApp] Failed to log error to DB:', logErr.message); }
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

// ============================================================
// Staff WhatsApp notifications when tenant sends a message
// ============================================================
const staffNotifyCache = new Map(); // issueId -> lastNotifyTimestamp
const STAFF_NOTIFY_COOLDOWN = 300000; // 5 minutes

async function notifyStaff(tenantName, propertyName, issueTitle, issueId, issueUuid, messagePreview) {
  try {
    // Rate limit per issue
    const lastNotify = staffNotifyCache.get(issueId);
    if (lastNotify && Date.now() - lastNotify < STAFF_NOTIFY_COOLDOWN) return;
    staffNotifyCache.set(issueId, Date.now());

    const db = getDb();
    const phoneSetting = db.prepare("SELECT value FROM settings WHERE key = 'staff_notify_phones'").get();
    db.close();
    if (!phoneSetting?.value) return;

    const phones = phoneSetting.value.split(',').map(p => p.trim()).filter(Boolean);
    if (phones.length === 0) return;

    const preview = (messagePreview || '').slice(0, 100);
    const msg = `New maintenance message from ${tenantName} at ${propertyName || 'Unknown property'}\n\nIssue: ${issueTitle}\nRef: ${issueUuid}\n\n"${preview}"\n\nView: https://maintenance.52oldelvet.com/issues/${issueId}`;

    for (const phone of phones) {
      sendWhatsAppMessage(phone, msg).catch(err => console.error('[Notify] Failed to notify', phone, err.message));
    }
  } catch (err) {
    console.error('[Notify] Staff notification error:', err.message);
  }
}

// ============================================================
// Auto WhatsApp status updates to tenants
// ============================================================
const STATUS_MESSAGES = {
  in_progress: (name, title, uuid) => `Hi ${name}, just to let you know we're looking into your ${title} now. Ref: ${uuid}`,
  escalated: (name, title, uuid) => `Hi ${name}, we've escalated your ${title} to our maintenance team for priority attention. Ref: ${uuid}`,
  resolved: (name, title, uuid) => `Hi ${name}, your ${title} has been resolved. If there are any problems, just message me again. Ref: ${uuid}`,
  closed: (name, title, uuid) => `Hi ${name}, your ${title} (Ref: ${uuid}) has been closed. If this issue comes back or you need anything else, just message me any time.`,
};

async function sendStatusUpdate(issueId, newStatus) {
  try {
    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'auto_status_updates'").get();
    if (setting?.value !== 'true') {
      console.log(`[Status Update] auto_status_updates is not enabled (value: ${setting?.value})`);
      db.close();
      return;
    }

    const issue = db.prepare(`
      SELECT i.*, t.name as tenant_name, t.phone as tenant_phone
      FROM issues i LEFT JOIN tenants t ON i.tenant_id = t.id WHERE i.id = ?
    `).get(issueId);
    db.close();

    if (!issue || !issue.tenant_phone) {
      console.log(`[Status Update] No issue or tenant phone for issue ${issueId}`);
      return;
    }
    const msgFn = STATUS_MESSAGES[newStatus];
    if (!msgFn) {
      console.log(`[Status Update] No message template for status "${newStatus}"`);
      return;
    }

    const firstName = issue.tenant_name?.split(' ')[0] || 'there';
    const msg = msgFn(firstName, issue.title || 'maintenance issue', issue.uuid);
    await sendWhatsAppMessage(issue.tenant_phone, msg);
    console.log(`[Status Update] Sent ${newStatus} update to ${issue.tenant_phone} for issue ${issue.uuid}`);
  } catch (err) {
    console.error('[Status Update] Error:', err.message);
  }
}

module.exports = { processIncomingMessage, sendWhatsAppMessage, sendStaffResponse, downloadWhatsAppMedia, sendStatusUpdate, notifyStaff };
