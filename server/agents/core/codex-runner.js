const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { getAgent } = require('../registry');

const execFileAsync = promisify(execFile);

const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const DEFAULT_WORKSPACE = path.resolve(__dirname, '..', '..', '..');

function isExecuteMode(mode) {
  return mode === 'execute' && process.env.CODEX_AGENT_MODE === 'execute';
}

async function getCodexVersion() {
  try {
    const { stdout } = await execFileAsync(CODEX_BIN, ['--version'], { timeout: 5000 });
    return stdout.trim();
  } catch (error) {
    return null;
  }
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

function getCodexCommand(prompt, options = {}) {
  const sandbox = options.sandbox || process.env.CODEX_AGENT_SANDBOX || 'read-only';
  const model = options.model || process.env.CODEX_AGENT_MODEL;
  const cwd = options.cwd || DEFAULT_WORKSPACE;
  const args = ['exec', '--cd', cwd, '--sandbox', sandbox, '--ask-for-approval', 'never', '--ephemeral'];
  if (model) args.push('--model', model);
  args.push(prompt);
  return { command: CODEX_BIN, args };
}

async function runCodexAgent({ agentKey, input = {}, context = {}, mode = 'dry_run', options = {} }) {
  const agent = getAgent(agentKey);
  if (!agent) throw new Error(`Unknown agent: ${agentKey}`);
  if (!agent.codex_enabled) throw new Error(`${agent.name} is not Codex-enabled`);

  const prompt = buildCodexPrompt(agent, input, context);
  const version = await getCodexVersion();
  const { command, args } = getCodexCommand(prompt, options);
  const commandPreview = `${command} ${args.slice(0, -1).join(' ')} [prompt]`;

  if (!version) {
    return {
      status: 'blocked',
      mode,
      output: 'Codex CLI was not found or is not available to the server process.',
      codex_version: null,
      codex_command: commandPreview,
      prompt_preview: prompt
    };
  }

  if (!isExecuteMode(mode)) {
    return {
      status: 'dry_run',
      mode,
      output: 'Dry run only. Set CODEX_AGENT_MODE=execute and call with mode=execute to run this agent through Codex.',
      codex_version: version,
      codex_command: commandPreview,
      prompt_preview: prompt
    };
  }

  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd || DEFAULT_WORKSPACE,
    timeout: Number(process.env.CODEX_AGENT_TIMEOUT_MS || 120000),
    maxBuffer: 1024 * 1024 * 5
  });

  return {
    status: 'completed',
    mode,
    output: stdout.trim() || stderr.trim(),
    codex_version: version,
    codex_command: commandPreview,
    prompt_preview: prompt
  };
}

module.exports = { runCodexAgent, buildCodexPrompt, getCodexVersion };
