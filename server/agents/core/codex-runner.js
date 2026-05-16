const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { promisify } = require('util');
const { getAgent } = require('../registry');
const { getDb } = require('../../database');

const execFileAsync = promisify(execFile);

const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const DEFAULT_WORKSPACE = path.resolve(__dirname, '..', '..', '..');
let lastCodexDiagnostics = null;

function isExecuteMode(mode) {
  return mode === 'execute' && process.env.CODEX_AGENT_MODE === 'execute';
}

function codexCandidates() {
  return [
    process.env.CODEX_BIN,
    path.join(DEFAULT_WORKSPACE, 'node_modules', '.bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    '/usr/bin/codex',
    'codex'
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
}

function getStoredOpenAIKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'openai_api_key'").get();
    db.close();
    return row?.value && row.value.length > 10 ? row.value : null;
  } catch {
    return null;
  }
}

function buildCodexEnv() {
  const env = { ...process.env };
  env.CODEX_HOME = env.CODEX_HOME || path.join(os.tmpdir(), 'ffr-property-os-codex');
  env.CI = env.CI || '1';
  if (!env.OPENAI_API_KEY) {
    const storedKey = getStoredOpenAIKey();
    if (storedKey) env.OPENAI_API_KEY = storedKey;
  }
  return env;
}

function execFileWithInput(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = options.timeout ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeout) : null;

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      if (timedOut) return reject(new Error('Timed out while authenticating Codex CLI'));
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(stderr || stdout || `Process exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.stdin.end(input || '');
  });
}

async function ensureCodexAuthenticated(codexStatus) {
  const env = buildCodexEnv();
  fs.mkdirSync(env.CODEX_HOME, { recursive: true });
  const authPath = path.join(env.CODEX_HOME, 'auth.json');
  if (fs.existsSync(authPath)) return { ok: true, method: 'cached_api_key', env };

  if (!env.OPENAI_API_KEY) {
    return {
      ok: false,
      env,
      error: 'Codex CLI is installed, but no OPENAI_API_KEY is available in Railway env vars or FFR Property OS settings.'
    };
  }

  try {
    await execFileWithInput(
      codexStatus.command,
      ['login', '--with-api-key'],
      `${env.OPENAI_API_KEY}\n`,
      { env, timeout: Number(process.env.CODEX_LOGIN_TIMEOUT_MS || 30000) }
    );
    return { ok: true, method: 'api_key_login', env };
  } catch (error) {
    return {
      ok: false,
      env,
      error: `Codex CLI API-key login failed: ${error.message}`,
      stderr: error.stderr || null
    };
  }
}

async function getCodexStatus() {
  const candidates = codexCandidates();
  const attempts = [];
  for (const candidate of candidates) {
    try {
      if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
        attempts.push({ command: candidate, ok: false, error: 'not found on filesystem' });
        continue;
      }
      const { stdout } = await execFileAsync(candidate, ['--version'], { timeout: 5000 });
      const status = {
        available: true,
        version: stdout.trim(),
        command: candidate,
        candidates,
        attempts,
        path: process.env.PATH || ''
      };
      lastCodexDiagnostics = status;
      return status;
    } catch (error) {
      attempts.push({ command: candidate, ok: false, error: error.code || error.message });
    }
  }
  const status = {
    available: false,
    version: null,
    command: CODEX_BIN,
    candidates,
    attempts,
    path: process.env.PATH || '',
    setup_hint: 'Install the Codex CLI in the Railway/server image or set CODEX_BIN to an executable path. The hosted app can still prepare prompts in dry-run mode.'
  };
  lastCodexDiagnostics = status;
  return status;
}

async function getCodexVersion() {
  const status = await getCodexStatus();
  return status.version;
}

function getCodexDiagnostics() {
  return lastCodexDiagnostics || {
    available: false,
    version: null,
    command: CODEX_BIN,
    candidates: codexCandidates(),
    path: process.env.PATH || ''
  };
}

function buildCodexPrompt(agent, input = {}, context = {}) {
  const payload = {
    agent: {
      key: agent.key,
      name: agent.name,
      domain: agent.domain,
      risk_level: agent.risk_level,
      guardrails: agent.guardrails
    },
    instructions: agent.codex_prompt,
    input,
    context,
    output_contract: {
      summary: 'Concise operational answer.',
      recommended_actions: 'Prioritised actions with owner, timing, and risk.',
      approvals_required: 'Any actions that must be approved before execution.',
      source_gaps: 'Missing data or documents that would change the recommendation.'
    }
  };

  return [
    'You are running inside FFR Property OS as a Codex-backed business agent.',
    'Respect all guardrails. Do not send external messages, approve payments, create legal notices, or alter records unless the input explicitly says this run has approval.',
    'Treat private property, tenant, staff, banking, and WhatsApp data as confidential. Summarise sensitive details instead of repeating them.',
    '',
    JSON.stringify(payload, null, 2)
  ].join('\n');
}

function getCodexCommand(prompt, options = {}, commandOverride = CODEX_BIN) {
  const sandbox = options.sandbox || process.env.CODEX_AGENT_SANDBOX || 'read-only';
  const model = options.model || process.env.CODEX_AGENT_MODEL;
  const cwd = options.cwd || DEFAULT_WORKSPACE;
  const args = ['exec', '--cd', cwd, '--sandbox', sandbox, '-c', 'approval_policy="never"', '--ephemeral', '--ignore-user-config'];
  if (model) args.push('--model', model);
  args.push(prompt);
  return { command: commandOverride, args };
}

async function runCodexAgent({ agentKey, input = {}, context = {}, mode = 'dry_run', options = {} }) {
  const agent = getAgent(agentKey);
  if (!agent) throw new Error(`Unknown agent: ${agentKey}`);
  if (!agent.codex_enabled) throw new Error(`${agent.name} is not Codex-enabled`);

  const prompt = buildCodexPrompt(agent, input, context);
  const codexStatus = await getCodexStatus();
  const { command, args } = getCodexCommand(prompt, options, codexStatus.command || CODEX_BIN);
  const commandPreview = `${command} ${args.slice(0, -1).join(' ')} [prompt]`;

  if (!codexStatus.available && !isExecuteMode(mode)) {
    return {
      status: 'dry_run',
      mode,
      output: 'Codex CLI is not available to this server process, so this run prepared the exact agent prompt only. Install Codex CLI on Railway or set CODEX_BIN to enable live execution.',
      codex_version: null,
      codex_command: commandPreview,
      codex_diagnostics: codexStatus,
      prompt_preview: prompt
    };
  }

  if (!codexStatus.available) {
    return {
      status: 'blocked',
      mode,
      output: 'Codex CLI was not found or is not available to the server process. Install the CLI in the deployment image or set CODEX_BIN to an executable path before using execute mode.',
      codex_version: null,
      codex_command: commandPreview,
      codex_diagnostics: codexStatus,
      prompt_preview: prompt
    };
  }

  if (!isExecuteMode(mode)) {
    return {
      status: 'dry_run',
      mode,
      output: 'Dry run only. Set CODEX_AGENT_MODE=execute and call with mode=execute to run this agent through Codex.',
      codex_version: codexStatus.version,
      codex_command: commandPreview,
      codex_diagnostics: codexStatus,
      prompt_preview: prompt
    };
  }

  const auth = await ensureCodexAuthenticated(codexStatus);
  if (!auth.ok) {
    return {
      status: 'blocked',
      mode,
      output: auth.error,
      codex_version: codexStatus.version,
      codex_command: commandPreview,
      codex_diagnostics: { ...codexStatus, auth_error: auth.error },
      prompt_preview: prompt
    };
  }

  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd || DEFAULT_WORKSPACE,
    env: auth.env,
    timeout: Number(process.env.CODEX_AGENT_TIMEOUT_MS || 120000),
    maxBuffer: 1024 * 1024 * 5
  });

  return {
    status: 'completed',
    mode,
    output: stdout.trim() || stderr.trim(),
    codex_version: codexStatus.version,
    codex_command: commandPreview,
    codex_diagnostics: { ...codexStatus, auth_method: auth.method },
    prompt_preview: prompt
  };
}

module.exports = { runCodexAgent, buildCodexPrompt, getCodexVersion, getCodexStatus, getCodexDiagnostics };
