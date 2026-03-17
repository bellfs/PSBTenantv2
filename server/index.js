require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initialiseDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/issues', require('./routes/issues'));
app.use('/api/contractors', require('./routes/contractors'));
app.use('/api/email', require('./routes/email'));
app.use('/api', require('./routes/api'));

const clientBuild = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuild));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(clientBuild, 'index.html'));
});

app.use((err, req, res, next) => { console.error('[Server Error]', err); res.status(500).json({ error: 'Internal server error' }); });

app.listen(PORT, async () => {
  await initialiseDatabase();
  const hasOpenAI = !!process.env.OPENAI_API_KEY, hasAnthropic = !!process.env.ANTHROPIC_API_KEY, hasWhatsApp = !!process.env.WHATSAPP_ACCESS_TOKEN;
  const provider = process.env.LLM_PROVIDER || 'openai';
  console.log(`\n  ╔═══════════════════════════════════════════════╗`);
  console.log(`  ║  PSB Properties Maintenance Hub               ║`);
  console.log(`  ║  Server running on http://localhost:${PORT}      ║`);
  console.log(`  ║  WhatsApp webhook: /api/webhook/whatsapp       ║`);
  console.log(`  ╠═══════════════════════════════════════════════╣`);
  console.log(`  ║  LLM Provider: ${provider.padEnd(31)}║`);
  console.log(`  ║  OpenAI Key:   ${(hasOpenAI ? 'SET' : 'MISSING').padEnd(31)}║`);
  console.log(`  ║  Anthropic Key:${(hasAnthropic ? 'SET' : 'MISSING').padEnd(31)}║`);
  console.log(`  ║  WhatsApp:     ${(hasWhatsApp ? 'SET' : 'MISSING').padEnd(31)}║`);
  console.log(`  ╚═══════════════════════════════════════════════╝\n`);
  if (!hasOpenAI && !hasAnthropic) console.warn('  ⚠ WARNING: No LLM API key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');

  // Start email sync scheduler
  try {
    const { startSyncScheduler } = require('./services/email-sync');
    startSyncScheduler();
  } catch (e) { console.log('  Email sync scheduler skipped:', e.message); }

  // Auto-subscribe this app to the WABA for webhook delivery
  if (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
    try {
      const axios = require('axios');
      const r = await axios.post(
        `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps`,
        {},
        { headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, timeout: 10000 }
      );
      console.log('  ✅ App subscribed to WABA webhooks:', r.data);
    } catch (err) {
      console.error('  ⚠ WABA subscription failed:', err.response?.data?.error?.message || err.message);
    }
  }
});

module.exports = app;
