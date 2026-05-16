#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');

const BASE_URL = process.env.FFR_OS_URL || 'http://localhost:3001';
const EMAIL = process.env.FFR_OS_EMAIL || process.env.ADMIN_EMAIL;
const PASSWORD = process.env.FFR_OS_PASSWORD || process.env.ADMIN_PASSWORD;
const TOKEN = process.env.FFR_OS_TOKEN;

function usage() {
  return `
FFR Property OS Codex bridge

Usage:
  node scripts/ffr-agent.js health
  node scripts/ffr-agent.js list
  node scripts/ffr-agent.js runs [limit]
  node scripts/ffr-agent.js run <agent_key> "<request>" [--mode dry_run|execute]
  node scripts/ffr-agent.js tasks [status]
  node scripts/ffr-agent.js intake:whatsapp <path-to-export.txt> [source_name]
  node scripts/ffr-agent.js email:run
  node scripts/ffr-agent.js email:report [--send]
  node scripts/ffr-agent.js memory:summary
  node scripts/ffr-agent.js memory:snapshot
  node scripts/ffr-agent.js memory:file <path>

Environment:
  FFR_OS_URL       Defaults to http://localhost:3001
  FFR_OS_TOKEN     Preferred auth path if you already have a JWT
  FFR_OS_EMAIL     Login email if no token is supplied
  FFR_OS_PASSWORD  Login password if no token is supplied

Examples:
  npm run agent -- list
  npm run agent -- run compliance_guardian "Check certificates expiring in 60 days"
  npm run agent -- run short_let_operator "Review 52OE summer booking risks" --mode dry_run
  npm run agent -- intake:whatsapp "/Users/fergusbell/Downloads/_chat 26.txt" team_group
  npm run agent -- email:run
  npm run agent -- email:report
  npm run agent -- memory:snapshot
  npm run agent -- memory:file wiki/index.md
`.trim();
}

function parseMode(args) {
  const index = args.indexOf('--mode');
  if (index === -1) return 'dry_run';
  return args[index + 1] || 'dry_run';
}

async function getToken() {
  if (TOKEN) return TOKEN;
  if (!EMAIL || !PASSWORD) {
    throw new Error('Set FFR_OS_TOKEN, or set FFR_OS_EMAIL and FFR_OS_PASSWORD so the bridge can log in.');
  }
  const response = await axios.post(`${BASE_URL}/api/auth/login`, { email: EMAIL, password: PASSWORD }, { timeout: 10000 });
  return response.data.token;
}

async function request(method, path, data) {
  const token = await getToken();
  const response = await axios({
    method,
    url: `${BASE_URL}${path}`,
    data,
    timeout: Number(process.env.FFR_OS_TIMEOUT_MS || 120000),
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || ['help', '--help', '-h'].includes(command)) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'health') {
    printJson(await request('get', '/api/agents/health'));
    return;
  }

  if (command === 'list') {
    const data = await request('get', '/api/agents');
    printJson(data.agents.map(agent => ({
      key: agent.key,
      name: agent.name,
      domain: agent.domain,
      mode: agent.mode,
      risk_level: agent.risk_level,
      last_run_at: agent.metrics?.last_run_at || null
    })));
    return;
  }

  if (command === 'runs') {
    const limit = args[0] || 20;
    printJson(await request('get', `/api/agents/runs?limit=${encodeURIComponent(limit)}`));
    return;
  }

  if (command === 'tasks') {
    const status = args[0] || 'open';
    printJson(await request('get', `/api/agents/tasks?status=${encodeURIComponent(status)}`));
    return;
  }

  if (command === 'intake:whatsapp') {
    const filePath = args[0];
    const sourceName = args[1] || (filePath ? filePath.split('/').pop().replace(/\.txt$/i, '') : 'whatsapp_export');
    if (!filePath) throw new Error('Usage: node scripts/ffr-agent.js intake:whatsapp <path-to-export.txt> [source_name]');
    const text = fs.readFileSync(filePath, 'utf8');
    printJson(await request('post', '/api/intake/whatsapp-export', { text, source_name: sourceName }));
    return;
  }

  if (command === 'email:run') {
    printJson(await request('post', '/api/email-agent/run'));
    return;
  }

  if (command === 'email:report') {
    const shouldSend = args.includes('--send');
    printJson(await request('post', shouldSend ? '/api/email-agent/reports/daily/send' : '/api/email-agent/reports/daily/preview', {}));
    return;
  }

  if (command === 'memory:summary') {
    printJson(await request('get', '/api/business-memory/summary'));
    return;
  }

  if (command === 'memory:snapshot') {
    printJson(await request('post', '/api/business-memory/snapshot', {}));
    return;
  }

  if (command === 'memory:file') {
    const memoryPath = args[0];
    if (!memoryPath) throw new Error('Usage: node scripts/ffr-agent.js memory:file <path>');
    printJson(await request('get', `/api/business-memory/file?path=${encodeURIComponent(memoryPath)}`));
    return;
  }

  if (command === 'run') {
    const agentKey = args[0];
    const requestText = args[1];
    if (!agentKey || !requestText) throw new Error('Usage: node scripts/ffr-agent.js run <agent_key> "<request>" [--mode dry_run|execute]');
    const mode = parseMode(args);
    const result = await request('post', `/api/agents/${encodeURIComponent(agentKey)}/run`, {
      mode,
      trigger_type: 'codex_bridge',
      input: { request: requestText },
      context: {
        source: 'codex_bridge',
        cwd: process.cwd(),
        launched_at: new Date().toISOString()
      }
    });
    printJson({
      id: result.id,
      agent_key: result.agent.key,
      agent_name: result.agent.name,
      status: result.result.status,
      mode: result.result.mode,
      output: result.result.output,
      codex_command: result.result.codex_command
    });
    return;
  }

  throw new Error(`Unknown command "${command}".\n\n${usage()}`);
}

main().catch(error => {
  const message = error.response?.data?.error || error.message;
  process.stderr.write(`FFR agent bridge failed: ${message}\n`);
  process.exit(1);
});
