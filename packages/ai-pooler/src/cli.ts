/**
 * Rulecatch AI Pooler - Zero Token Overhead Tracking
 *
 * Commands:
 *   npx @rulecatch/ai-pooler init        - Interactive setup
 *   npx @rulecatch/ai-pooler uninstall   - Remove everything
 *   npx @rulecatch/ai-pooler status      - Check setup and buffer
 *   npx @rulecatch/ai-pooler check       - View recent violations
 *   npx @rulecatch/ai-pooler flush       - Force flush buffered events
 *   npx @rulecatch/ai-pooler logs        - Show flush activity logs
 *   npx @rulecatch/ai-pooler config      - Update configuration
 *   npx @rulecatch/ai-pooler monitor     - Live event stream (alias: live)
 *     -v / --verbose                     - Show file paths, git context
 *     -vv / --debug                      - Full JSON event dump
 *   npx @rulecatch/ai-pooler backpressure - Show backpressure status
 */

import { init, uninstall, findFlushScript, findFile } from './init.js';
import { loadState, getStatusSummary } from './backpressure.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { pbkdf2Sync, createDecipheriv } from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PKG_VERSION: string = (require('../package.json') as { version: string }).version;

const args = process.argv.slice(2);
const command = args[0];

// Commands that work without a valid API key
const EXEMPT_COMMANDS = new Set(['init', 'help', '--help', '-h', 'uninstall', 'remove', 'monitor', 'live', undefined]);

/**
 * Validate that config exists with a valid API key.
 * Exits with a clear error if not configured.
 * Monitor-only mode (monitorOnly: true) is allowed without an API key.
 */
function requireConfig(): void {
  if (EXEMPT_COMMANDS.has(command)) return;

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`\x1b[31m\nNot configured.\x1b[0m Run \x1b[1mnpx @rulecatch/ai-pooler init\x1b[0m to set up.\n`);
    process.exit(1);
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    // Monitor-only mode doesn't need an API key
    if (config.monitorOnly === true) return;
    if (!config.apiKey || typeof config.apiKey !== 'string' || !config.apiKey.startsWith('dc_')) {
      console.error(`\x1b[31m\nInvalid API key in config.\x1b[0m Run \x1b[1mnpx @rulecatch/ai-pooler init\x1b[0m to reconfigure.\n`);
      process.exit(1);
    }
  } catch {
    console.error(`\x1b[31m\nCorrupt config file.\x1b[0m Run \x1b[1mnpx @rulecatch/ai-pooler init\x1b[0m to reconfigure.\n`);
    process.exit(1);
  }
}

// Colors
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// Paths
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const RULECATCH_DIR = path.join(CLAUDE_DIR, 'rulecatch');
const CONFIG_PATH = path.join(RULECATCH_DIR, 'config.json');
const BUFFER_DIR = path.join(RULECATCH_DIR, 'buffer');
const EVENTS_LOG = path.join(RULECATCH_DIR, 'events.log');
const LOG_FILE = path.join(RULECATCH_DIR, 'flush.log');
const HOOK_LOG = '/tmp/rulecatch-hook.log';
const SESSION_FILE = path.join(RULECATCH_DIR, '.session');
const HOOK_SCRIPT = path.join(CLAUDE_DIR, 'hooks', 'rulecatch-track.sh');
const FLUSH_SCRIPT = path.join(CLAUDE_DIR, 'hooks', 'rulecatch-flush.js');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const BACKPRESSURE_STATE_FILE = path.join(RULECATCH_DIR, '.backpressure-state');
const PAUSED_FILE = path.join(RULECATCH_DIR, '.paused');

const HOOK_VERSION_FILE = path.join(RULECATCH_DIR, '.hook-version');

/**
 * Auto-update hooks if the installed version differs from the running CLI version.
 * Runs silently before command dispatch so every `npx @rulecatch/ai-pooler@latest` keeps hooks current.
 */
function autoUpdateHooks(): void {
  // Only update if hooks are already installed (user ran init before)
  if (!fs.existsSync(HOOK_SCRIPT) && !fs.existsSync(FLUSH_SCRIPT)) return;

  // Compare installed hook version with current CLI version
  let installedVersion = '';
  try {
    if (fs.existsSync(HOOK_VERSION_FILE)) {
      installedVersion = fs.readFileSync(HOOK_VERSION_FILE, 'utf-8').trim();
    }
  } catch { /* treat as missing */ }

  if (installedVersion === PKG_VERSION) return;

  // Version mismatch — update hooks
  let updated = false;

  // Update flush script
  const flushSource = findFlushScript();
  if (flushSource) {
    try {
      fs.copyFileSync(flushSource, FLUSH_SCRIPT);
      fs.chmodSync(FLUSH_SCRIPT, 0o755);
      updated = true;
    } catch { /* silent */ }
  }

  // Update hook script from template
  const hookTemplate = findFile('rulecatch-track.sh');
  if (hookTemplate) {
    try {
      fs.copyFileSync(hookTemplate, HOOK_SCRIPT);
      fs.chmodSync(HOOK_SCRIPT, 0o755);
      updated = true;
    } catch { /* silent */ }
  }

  if (updated) {
    // Write new version marker
    try {
      fs.mkdirSync(RULECATCH_DIR, { recursive: true });
      fs.writeFileSync(HOOK_VERSION_FILE, PKG_VERSION);
    } catch { /* silent */ }
    console.log(`\x1b[32m✓ Hooks updated to v${PKG_VERSION}\x1b[0m`);
  }
}

function parseArgs(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (key && value) {
        result[key.replace(/-/g, '')] = value;
      }
    }
  }
  return result;
}

function getBufferCount(): number {
  try {
    if (!fs.existsSync(BUFFER_DIR)) return 0;
    return fs.readdirSync(BUFFER_DIR).filter(f => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function main() {
  autoUpdateHooks();
  requireConfig();

  switch (command) {
    case 'init': {
      const flags = parseArgs();
      await init({
        apiKey: flags.apikey || flags.key,
        projectId: flags.projectid || flags.project,
        region: (flags.region as 'us' | 'eu') || undefined,
        batchSize: flags.batchsize ? parseInt(flags.batchsize, 10) : undefined,
        encryptionKey: flags.encryptionkey,
        monitorOnly: args.includes('--monitor-only'),
      });
      break;
    }

    case 'uninstall':
    case 'remove': {
      uninstall();
      break;
    }

    case 'status': {
      console.log('\nRulecatch Status\n');

      // Check if paused due to subscription
      if (fs.existsSync(PAUSED_FILE)) {
        try {
          const pausedInfo = JSON.parse(fs.readFileSync(PAUSED_FILE, 'utf-8'));
          console.log(`Collection:    ${red('⏸ PAUSED')}`);
          console.log(`  Reason:      ${dim(pausedInfo.reason || 'subscription_expired')}`);
          console.log(`  Since:       ${dim(pausedInfo.pausedAt || 'unknown')}`);
          console.log(`  ${yellow('Run `npx @rulecatch/ai-pooler reactivate` after subscribing')}\n`);
        } catch {
          console.log(`Collection:    ${red('⏸ PAUSED')} (corrupt file)\n`);
        }
      } else {
        console.log(`Collection:    ${green('+ Active')}\n`);
      }

      // Check config
      if (fs.existsSync(CONFIG_PATH)) {
        try {
          const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
          console.log(`Config:        ${green('+ Found')}`);
          if (config.monitorOnly) {
            console.log(`  Mode:        ${yellow('Monitor only (no API key)')}`);
          } else {
            console.log(`  API key:     ${dim(config.apiKey?.slice(0, 8) + '...')}`);
          }
          console.log(`  Region:      ${dim(config.region === 'eu' ? 'EU (Frankfurt)' : 'US (Virginia)')}`);
          console.log(`  Batch size:  ${dim(String(config.batchSize || 20))}`);
          console.log(`  Encrypted:   ${config.encryptionKey ? green('Yes') : yellow('No')}`);
        } catch {
          console.log(`Config:        ${red('x Parse error')}`);
        }
      } else {
        console.log(`Config:        ${red('x Not found')}`);
        console.log(dim('  Run `npx @rulecatch/ai-pooler init` to set up.\n'));
        break;
      }

      // Check hook script
      console.log(`\nHook script:   ${fs.existsSync(HOOK_SCRIPT) ? green('+ Installed') : red('x Not found')}`);
      console.log(`Flush script:  ${fs.existsSync(FLUSH_SCRIPT) ? green('+ Installed') : red('x Not found')}`);

      // Check hooks in settings.json (all 14 hook types)
      const ALL_HOOK_TYPES = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'TeammateIdle', 'TaskCompleted', 'PreCompact'];
      let hooksConfigured = 0;
      if (fs.existsSync(SETTINGS_PATH)) {
        try {
          const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
          for (const h of ALL_HOOK_TYPES) {
            if (settings.hooks?.[h]) hooksConfigured++;
          }
        } catch { /* ignore */ }
      }
      const hooksOk = hooksConfigured === ALL_HOOK_TYPES.length;
      console.log(`Hooks config:  ${hooksOk ? green(`+ All ${hooksConfigured}/${ALL_HOOK_TYPES.length} registered`) : red(`x ${hooksConfigured}/${ALL_HOOK_TYPES.length} registered (run init to fix)`)}`);

      // Buffer status
      const bufferCount = getBufferCount();
      console.log(`\nBuffer:        ${bufferCount} events pending`);

      // Session token
      if (fs.existsSync(SESSION_FILE)) {
        try {
          const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
          const expiresIn = Math.max(0, Math.round((session.expiry - Date.now()) / 1000 / 60));
          console.log(`Session token: ${green('+ Valid')} (expires in ${expiresIn}m)`);
        } catch {
          console.log(`Session token: ${yellow('o Expired/corrupt')}`);
        }
      } else {
        console.log(`Session token: ${dim('Not acquired yet')}`);
      }

      // Hook log
      if (fs.existsSync(HOOK_LOG)) {
        const lines = fs.readFileSync(HOOK_LOG, 'utf-8').trim().split('\n');
        const lastLine = lines[lines.length - 1] || '';
        console.log(`\nHook log:      ${green('+ Active')} (${lines.length} entries)`);
        console.log(`Last activity: ${dim(lastLine)}`);
      } else {
        console.log(`\nHook log:      ${yellow('o No activity yet')}`);
      }

      // Backpressure status (brief summary)
      const bpState = loadState();
      if (bpState.consecutiveFailures > 0 || bpState.backoffLevel > 0) {
        console.log(`\nBackpressure:  ${yellow('o Active')}`);
        if (bpState.consecutiveFailures > 0) {
          console.log(`  Failures:    ${bpState.consecutiveFailures} consecutive`);
        }
        if (bpState.backoffLevel > 0) {
          console.log(`  Backoff:     Level ${bpState.backoffLevel}/10`);
        }
        if (bpState.nextAttemptAfter > Date.now()) {
          const waitSec = Math.ceil((bpState.nextAttemptAfter - Date.now()) / 1000);
          console.log(`  Next retry:  ${waitSec}s`);
        }
        console.log(dim('  Run `npx @rulecatch/ai-pooler backpressure` for details'));
      } else {
        console.log(`\nBackpressure:  ${green('+ Healthy')}`);
      }

      console.log('');
      break;
    }

    case 'flush': {
      // Check if monitor-only mode
      let isMonitorOnly = false;
      try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        isMonitorOnly = config.monitorOnly === true;
      } catch { /* ignore */ }

      if (isMonitorOnly) {
        const bufferCount = getBufferCount();
        console.log(`\n${bufferCount} events in buffer (monitor-only mode).`);

        // In monitor mode, flush just deletes buffer files — no API call
        if (fs.existsSync(FLUSH_SCRIPT)) {
          try {
            execSync(`node "${FLUSH_SCRIPT}" --force`, { stdio: 'inherit' });
          } catch { /* ignore */ }
        }
        const remaining = getBufferCount();
        console.log(green(`${bufferCount - remaining} events cleared (monitor-only — events not sent to API).\n`));
        break;
      }

      console.log('\nFlushing buffered events...\n');

      const bufferCount = getBufferCount();
      if (bufferCount === 0) {
        console.log(yellow('No events in buffer.\n'));
        break;
      }

      console.log(`${bufferCount} events in buffer.`);

      if (fs.existsSync(FLUSH_SCRIPT)) {
        try {
          execSync(`node "${FLUSH_SCRIPT}" --force`, { stdio: 'inherit' });
          const remaining = getBufferCount();
          if (remaining === 0) {
            console.log(green('\n+ All events flushed.\n'));
          } else {
            console.log(yellow(`\n${remaining} events remaining (API may be unreachable).\n`));
          }
        } catch {
          console.log(red('\nFlush failed. Check logs with `npx @rulecatch/ai-pooler logs`.\n'));
        }
      } else {
        console.log(red('Flush script not found. Run `npx @rulecatch/ai-pooler init` to reinstall.\n'));
      }
      break;
    }

    case 'logs': {
      const flags = parseArgs();
      const lineCount = parseInt(flags.lines || '30', 10);
      const source = flags.source || 'flush';

      const logPath = source === 'hook' ? HOOK_LOG : LOG_FILE;
      const label = source === 'hook' ? 'Hook' : 'Flush';

      console.log(`\nRulecatch ${label} Logs (last ${lineCount} entries)\n`);

      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
        const recent = content.slice(-lineCount);
        recent.forEach((line) => console.log(dim(line)));
        console.log(`\n${dim(`Total entries: ${content.length}`)}`);
        console.log(`${dim(`Log file: ${logPath}`)}\n`);
      } else {
        console.log(yellow(`No ${label.toLowerCase()} log found.`));
        console.log('No events have been processed yet.\n');
      }
      break;
    }

    case 'config': {
      const flags = parseArgs();

      if (!fs.existsSync(CONFIG_PATH)) {
        console.log(red('\nNot configured. Run `npx @rulecatch/ai-pooler init` first.\n'));
        process.exit(1);
      }

      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      let changed = false;

      if (flags.batchsize) {
        config.batchSize = parseInt(flags.batchsize, 10);
        changed = true;
      }
      if (flags.region && (flags.region === 'us' || flags.region === 'eu')) {
        config.region = flags.region;
        changed = true;
      }

      if (flags.showkey === 'true' || args.includes('--show-key')) {
        if (config.encryptionKey) {
          console.log('\nYour encryption key:\n');
          console.log(`  ${green(config.encryptionKey)}\n`);
          console.log(dim('Use this key in the dashboard "Decrypt Data" button to view your personal data.'));
          console.log(dim('Keep it safe — we cannot recover it if lost.\n'));
        } else {
          console.log(yellow('\nNo encryption key configured. Run `npx @rulecatch/ai-pooler init` to set one up.\n'));
        }
        break;
      }

      if (changed) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
        console.log(green('\n+ Config updated.\n'));
      } else {
        console.log('\nCurrent config:\n');
        console.log(`  API key:     ${config.apiKey?.slice(0, 8)}...`);
        console.log(`  Region:      ${config.region === 'eu' ? 'EU (Frankfurt)' : 'US (Virginia)'}`);
        console.log(`  Batch size:  ${config.batchSize || 20}`);
        console.log(`  Encrypted:   ${config.encryptionKey ? 'Yes' : 'No'}`);
        console.log(dim('\nOverrides:'));
        console.log(dim('  --batch-size=30'));
        console.log(dim('  --region=eu'));
        console.log(dim('  --show-key        Show your encryption key\n'));
      }
      break;
    }

    case 'backpressure':
    case 'bp': {
      console.log('\nBackpressure Status\n');

      const state = loadState();

      // Overall health
      const isHealthy = state.consecutiveFailures === 0 && state.backoffLevel === 0;
      if (isHealthy) {
        console.log(`Status:           ${green('Healthy')}`);
      } else if (state.consecutiveFailures >= 10) {
        console.log(`Status:           ${red('Circuit Breaker OPEN')}`);
      } else if (state.backoffLevel >= 5) {
        console.log(`Status:           ${red('High Backoff')}`);
      } else {
        console.log(`Status:           ${yellow('Backing Off')}`);
      }

      // Failure info
      console.log(`\nFailures:         ${state.consecutiveFailures} consecutive`);
      console.log(`Backoff level:    ${state.backoffLevel}/10`);

      // Timing
      if (state.nextAttemptAfter > Date.now()) {
        const waitSec = Math.ceil((state.nextAttemptAfter - Date.now()) / 1000);
        console.log(`Next attempt in:  ${waitSec}s`);
      } else {
        console.log(`Next attempt:     ${green('Ready now')}`);
      }

      if (state.lastSuccessTime > 0) {
        const ago = Math.floor((Date.now() - state.lastSuccessTime) / 1000);
        if (ago < 60) {
          console.log(`Last success:     ${ago}s ago`);
        } else if (ago < 3600) {
          console.log(`Last success:     ${Math.floor(ago / 60)}m ago`);
        } else {
          console.log(`Last success:     ${Math.floor(ago / 3600)}h ago`);
        }
      } else {
        console.log(`Last success:     ${dim('Never')}`);
      }

      // Buffer
      console.log(`\nPending events:   ${state.pendingEventCount}`);

      // Last known server capacity
      if (state.lastCapacity) {
        console.log(`\nLast Server Response:`);
        console.log(`  Ready:          ${state.lastCapacity.ready ? green('Yes') : red('No')}`);
        console.log(`  Max batch:      ${state.lastCapacity.maxBatchSize}`);
        console.log(`  Delay between:  ${state.lastCapacity.delayBetweenBatches}ms`);
        if (state.lastCapacity.loadPercent !== undefined) {
          const loadColor = state.lastCapacity.loadPercent > 80 ? red :
                           state.lastCapacity.loadPercent > 50 ? yellow : green;
          console.log(`  Server load:    ${loadColor(state.lastCapacity.loadPercent + '%')}`);
        }
        if (state.lastCapacity.message) {
          console.log(`  Message:        ${dim(state.lastCapacity.message)}`);
        }
      }

      // Reset option
      const flags = parseArgs();
      if (flags.reset === 'true') {
        if (fs.existsSync(BACKPRESSURE_STATE_FILE)) {
          fs.unlinkSync(BACKPRESSURE_STATE_FILE);
        }
        console.log(green('\n+ Backpressure state reset.\n'));
      } else if (state.consecutiveFailures > 0 || state.backoffLevel > 0) {
        console.log(dim('\nTo reset: npx @rulecatch/ai-pooler backpressure --reset=true'));
      }

      console.log('');
      break;
    }

    case 'reactivate': {
      console.log('\nChecking subscription status...\n');

      // Check if configured
      if (!fs.existsSync(CONFIG_PATH)) {
        console.log(red('Not configured. Run `npx @rulecatch/ai-pooler init` first.\n'));
        process.exit(1);
      }

      // Read config for region
      let config: { apiKey?: string; region?: 'us' | 'eu' };
      try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      } catch {
        console.log(red('Failed to read config. Run `npx @rulecatch/ai-pooler init` to reconfigure.\n'));
        process.exit(1);
      }

      if (!config.apiKey) {
        console.log(red('No API key configured. Run `npx @rulecatch/ai-pooler init` first.\n'));
        process.exit(1);
      }

      // Remove paused file to allow session token request
      if (fs.existsSync(PAUSED_FILE)) {
        fs.unlinkSync(PAUSED_FILE);
      }

      // Remove old session file to force re-auth
      if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
      }

      // Try to acquire a session token to check subscription
      const region = config.region || 'us';
      const baseUrl = region === 'eu'
        ? 'https://api-eu.rulecatch.ai'
        : 'https://api.rulecatch.ai';

      try {
        const response = await fetch(`${baseUrl}/api/v1/ai/pooler/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            projectId: 'reactivate-check',
            region,
            encrypted: true,
          }),
        });

        if (response.ok) {
          // Subscription is active!
          console.log(green('✓ Subscription active!'));
          console.log('\nData collection has been reactivated.');
          console.log('Events will be sent on your next Claude Code session.\n');
          process.exit(0);
        }

        // Check for paused response
        if (response.status === 403) {
          const errorBody = await response.json() as {
            status?: string;
            reason?: string;
            message?: string;
            billingUrl?: string;
          };

          if (errorBody.status === 'paused') {
            // Write paused file again
            fs.writeFileSync(PAUSED_FILE, JSON.stringify({
              reason: errorBody.reason,
              message: errorBody.message,
              region,
              dashboardUrl: `https://dashboard${region === 'eu' ? '-eu' : ''}.rulecatch.ai`,
              billingUrl: errorBody.billingUrl,
              pausedAt: new Date().toISOString(),
            }, null, 2), { mode: 0o600 });

            console.log(red('✗ Subscription still inactive.\n'));
            console.log('╔═══════════════════════════════════════════════════════════════╗');
            console.log('║                  SUBSCRIPTION REQUIRED                         ║');
            console.log('╠═══════════════════════════════════════════════════════════════╣');
            console.log('║                                                               ║');
            console.log(`║   ${errorBody.message || 'Your subscription has expired.'}`.padEnd(64) + '║');
            console.log('║                                                               ║');
            console.log('║   To reactivate data collection:                              ║');
            console.log('║                                                               ║');
            console.log('║   1. Visit your billing page:                                 ║');
            console.log(`║      ${errorBody.billingUrl || `https://dashboard${region === 'eu' ? '-eu' : ''}.rulecatch.ai/billing`}`.padEnd(60) + '║');
            console.log('║                                                               ║');
            console.log('║   2. Subscribe or update your payment method                  ║');
            console.log('║                                                               ║');
            console.log('║   3. Return here and run:                                     ║');
            console.log('║      npx @rulecatch/ai-pooler reactivate                      ║');
            console.log('║                                                               ║');
            console.log('╚═══════════════════════════════════════════════════════════════╝');
            console.log('');
            process.exit(1);
          }
        }

        // Other error
        console.log(red(`✗ Failed to check subscription (${response.status})`));
        console.log('Please try again or contact support.\n');
        process.exit(1);
      } catch (err) {
        console.log(red('✗ Network error'));
        console.log(`Could not connect to ${baseUrl}`);
        console.log('Please check your internet connection and try again.\n');
        process.exit(1);
      }
      break;
    }

    case 'monitor':
    case 'live': {
      // Live monitoring view — watches buffer + flush log in real-time
      // Debug levels: (none) = compact, -v = verbose (paths), -vv/--debug = full JSON
      const noApiKey = args.includes('--no-api-key');

      if (noApiKey) {
        // Force monitor-only mode — overwrite config if needed
        if (!fs.existsSync(CONFIG_PATH)) {
          await init({ monitorOnly: true });
        } else {
          const existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
          if (existing.apiKey) {
            // Wipe API key for this session — write monitor-only config
            existing.apiKey = '';
            existing.monitorOnly = true;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), { mode: 0o600 });
          }
        }
      } else if (!fs.existsSync(CONFIG_PATH)) {
        console.log(red('Not configured. Run `npx @rulecatch/ai-pooler init` first.\n'));
        process.exit(1);
      }

      const verboseCount = args.filter(a => a === '-v').length + (args.includes('--verbose') ? 1 : 0);
      const debugMode = args.includes('-vv') || args.includes('--debug') || verboseCount >= 2;
      const verboseMode = debugMode || verboseCount >= 1;
      const demoMode = args.includes('--demo');
      const showPrompt = args.includes('--show-prompt');

      const DEMO_PROJECT = '/home/customer/projects/my_project';
      const DEMO_REPO = 'git@github.com:TheCustomer/project.git';

      const monConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const monEndpoint = monConfig.endpoint || (monConfig.region === 'eu' ? 'https://api-eu.rulecatch.ai' : 'https://api.rulecatch.ai');
      const isMonitorOnly = !monConfig.apiKey;

      // Derive encryption key once for decrypting buffer events
      let decryptKey: Buffer | null = null;
      if (monConfig.encryptionKey) {
        try {
          decryptKey = pbkdf2Sync(monConfig.encryptionKey, 'rulecatch', 100000, 32, 'sha256');
        } catch { /* no decryption available */ }
      }

      // Decrypt a hook-encrypted field (format: iv_base64:ciphertext+tag_base64)
      const decryptHookField = (encrypted: string): string => {
        if (!decryptKey || !encrypted || !encrypted.includes(':')) return '';
        try {
          const [ivB64, ctB64] = encrypted.split(':');
          const iv = Buffer.from(ivB64, 'base64');
          const ctWithTag = Buffer.from(ctB64, 'base64');
          const tag = ctWithTag.subarray(ctWithTag.length - 16);
          const ciphertext = ctWithTag.subarray(0, ctWithTag.length - 16);
          const decipher = createDecipheriv('aes-256-gcm', decryptKey, iv);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        } catch {
          return '';
        }
      };

      // Cache decrypted cwd per session (populated from session_start events)
      const cwdCache = new Map<string, string>();
      const getCwd = (evt: Record<string, unknown>): string => {
        const sessionId = evt.sessionId as string;
        if (sessionId && cwdCache.has(sessionId)) return cwdCache.get(sessionId)!;
        // Try plaintext first (privacy disabled)
        let cwd = (evt.cwd as string) || '';
        // Try decrypting (privacy enabled)
        if (!cwd) {
          const encrypted = (evt.cwdEncrypted as string) || '';
          if (encrypted) cwd = decryptHookField(encrypted);
        }
        if (cwd && sessionId) cwdCache.set(sessionId, cwd);
        return cwd;
      };

      const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
      const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
      const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
      const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;

      // Severity icons
      const sevIcon = (sev: string) => {
        if (sev === 'error') return red('🔴');
        if (sev === 'warning') return yellow('⚠️ ');
        return dim('ℹ️ ');
      };

      // Check API connectivity + fetch plan/usage info
      let apiStatus = yellow('⚠️  API not running');
      let planInfo = '';
      let usageInfo = '';
      let modelInfo = '';

      if (isMonitorOnly) {
        // Monitor-only mode: ping the gate endpoint instead of validate-key
        try {
          const res = await fetch(`${monEndpoint}/api/v1/ai/monitor-ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monitorOnly: true, projectId: monConfig.projectId, region: monConfig.region, cliArgs: process.argv.slice(2) }),
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            const data = await res.json() as { accepted?: boolean; message?: string };
            if (data.accepted === false) {
              console.log(red(`\n  ✗ ${data.message || 'Monitor mode disabled.'}\n`));
              process.exit(1);
            }
            apiStatus = yellow('monitor only');
          } else {
            apiStatus = yellow('monitor only');
          }
        } catch {
          apiStatus = yellow('monitor only (offline)');
        }
      } else {
        // Full mode: validate API key
        try {
          const res = await fetch(`${monEndpoint}/api/v1/ai/validate-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${monConfig.apiKey}` },
            body: JSON.stringify({ apiKey: monConfig.apiKey }),
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            apiStatus = green('✅ connected');
            const data = await res.json() as Record<string, unknown>;
            // Plan info
            const plan = (data.planId as string || 'starter').charAt(0).toUpperCase() + (data.planId as string || 'starter').slice(1);
            const status = data.subscriptionStatus as string || '';
            const trialDays = data.trialDaysLeft as number | undefined;
            if (status === 'trialing' && trialDays !== undefined) {
              planInfo = `${cyan(plan)} ${yellow(`(trial: ${trialDays}d left)`)}`;
            } else {
              planInfo = `${cyan(plan)} ${dim(`(${status})`)}`;
            }
            // Token usage
            const usage = data.tokenUsage as { totalTokens: number; totalCost: number; sessions: number } | undefined;
            if (usage) {
              const tokens = usage.totalTokens > 1000000 ? `${(usage.totalTokens / 1000000).toFixed(1)}M` : usage.totalTokens > 1000 ? `${(usage.totalTokens / 1000).toFixed(1)}K` : `${usage.totalTokens}`;
              usageInfo = `${tokens} tokens  ${green(`$${usage.totalCost.toFixed(2)}`)}  ${dim(`${usage.sessions} sessions`)}`;
            }
            // Model
            const model = data.model as string | undefined;
            if (model) {
              // Pretty-print model name: "claude-opus-4-6" → "Claude Opus 4.6"
              const pretty = model.replace('claude-', '').replace(/-(\d+)-(\d+)/, ' $1.$2').replace(/\b\w/g, c => c.toUpperCase());
              modelInfo = magenta(pretty);
            }
          } else if (res.status === 401) {
            apiStatus = yellow('⚠️  Invalid API key');
            // Don't exit — still show local events
          } else {
            apiStatus = yellow(`⚠️  ${res.status}`);
          }
        } catch {
          apiStatus = yellow('⚠️  API not running — will show events locally');
        }
      }

      // Print header box
      const BOX_W = 62;
      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
      // Count visible terminal columns (emojis are 2 wide)
      const visibleWidth = (s: string) => {
        const plain = stripAnsi(s);
        let w = 0;
        for (const ch of plain) {
          w += ch.charCodeAt(0) > 0xFF ? 2 : 1;
        }
        return w;
      };
      const boxLine = (content: string) => {
        const w = visibleWidth(content);
        const pad = Math.max(0, BOX_W - w);
        return ` │${content}${' '.repeat(pad)}│`;
      };
      const hLine = dim('─'.repeat(BOX_W));
      console.log('');
      console.log(` ┌${hLine}┐`);
      console.log(boxLine(` ${bold('RuleCatch.AI Monitor')}  ${dim(`v${PKG_VERSION}`)}`));
      console.log(` ├${hLine}┤`);
      console.log(boxLine(` API:     ${apiStatus}`));
      if (isMonitorOnly) {
        console.log(boxLine(` Key:     ${dim('(none)')}`));
      } else {
        console.log(boxLine(` Key:     ${dim(monConfig.apiKey?.slice(0, 12) + '...')}`));
      }
      console.log(boxLine(` Project: ${cyan(demoMode ? 'my_project' : (monConfig.projectId || '(not set)'))}`));
      console.log(boxLine(` Region:  ${monConfig.region === 'eu' ? 'EU' : 'US'}`));
      if (planInfo) console.log(boxLine(` Plan:    ${planInfo}`));
      if (modelInfo) console.log(boxLine(` Model:   ${modelInfo}`));
      if (usageInfo) console.log(boxLine(` Usage:   ${usageInfo}`));
      console.log(boxLine(` Buffer:  ${getBufferCount()} events pending`));
      console.log(boxLine(` Level:   ${debugMode ? magenta('debug (full JSON)') : verboseMode ? cyan('verbose (file paths)') : dim('compact')}`));
      console.log(` └${hLine}┘`);

      // CTA footer for monitor-only users
      if (isMonitorOnly) {
        console.log('');
        console.log(` ┌${hLine}┐`);
        console.log(boxLine(` ${yellow('🔑')} Get your API key at ${cyan('https://rulecatch.ai')}`));
        console.log(boxLine(`    Then run: ${bold('npx @rulecatch/ai-pooler init --api-key=KEY')}`));
        console.log(` └${hLine}┘`);
      }

      console.log('');
      console.log(` ${dim('Watching for events... (Ctrl+C to stop)')}`);
      if (!verboseMode) console.log(` ${dim('Tip: use -v for file paths, -vv for full event JSON')}`)
      console.log('');

      // Running session counters (start from server totals, increment locally)
      const serverUsage = { totalTokens: 0, totalCost: 0, sessions: 0 };
      if (!isMonitorOnly) {
        try {
          const res2 = await fetch(`${monEndpoint}/api/v1/ai/validate-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${monConfig.apiKey}` },
            body: JSON.stringify({ apiKey: monConfig.apiKey }),
            signal: AbortSignal.timeout(3000),
          });
          if (res2.ok) {
            const d2 = await res2.json() as Record<string, unknown>;
            const u = d2.tokenUsage as { totalTokens: number; totalCost: number; sessions: number } | undefined;
            if (u) { serverUsage.totalTokens = u.totalTokens; serverUsage.totalCost = u.totalCost; serverUsage.sessions = u.sessions; }
          }
        } catch { /* use zeros */ }
      }

      let runningTokens = serverUsage.totalTokens;
      let runningCost = serverUsage.totalCost;
      const runningModel = modelInfo || dim('unknown');

      const fmtRunning = () => {
        const tk = runningTokens > 1000000 ? `${(runningTokens / 1000000).toFixed(1)}M` : runningTokens > 1000 ? `${(runningTokens / 1000).toFixed(1)}K` : `${runningTokens}`;
        return dim(`[${runningModel} │ ${tk} tk │ $${runningCost.toFixed(2)}]`);
      };

      // Track position in events.log (JSONL file the hook appends to)
      let eventsLogSize = 0;
      if (fs.existsSync(EVENTS_LOG)) {
        // Pre-scan existing events.log for session_start cwds (skip displaying them)
        const existing = fs.readFileSync(EVENTS_LOG, 'utf-8');
        eventsLogSize = Buffer.byteLength(existing);
        for (const line of existing.split('\n').filter(Boolean)) {
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'session_start') getCwd(evt);
          } catch { /* skip */ }
        }
      }

      // Format a timestamp with date + time
      const fmtDateTime = (d: Date) => {
        const date = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
        const time = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `${date} ${time}`;
      };
      const fmtTime = (ts: string) => {
        try {
          return dim(fmtDateTime(new Date(ts)));
        } catch { return dim('--:--:--'); }
      };

      // Track last session_end time for context clear detection
      let lastSessionEndTime: number | null = null;
      // Track whether any tool calls happened in the current turn
      let turnHadToolCalls = false;
      // Track compaction start time for duration calculation
      let compactionStartTime: number | null = null;

      // Format a tool call event
      const fmtEvent = (evt: Record<string, unknown>) => {
        const time = fmtTime(evt.timestamp as string);
        const type = evt.type as string;

        // Increment running counters from event data
        const evtInputTk = (evt.toolInputSize as number) || 0;
        const evtOutputTk = (evt.toolOutputSize as number) || 0;
        if (type === 'tool_call') {
          runningTokens += evtInputTk + evtOutputTk;
          // Estimate cost from model pricing (per token)
          const m = (evt.model as string || '').toLowerCase();
          let inRate = 0.000003; let outRate = 0.000015; // default sonnet
          if (m.includes('opus')) { inRate = 0.000015; outRate = 0.000075; }
          else if (m.includes('haiku')) { inRate = 0.00000025; outRate = 0.00000125; }
          runningCost += (evtInputTk * inRate) + (evtOutputTk * outRate);
        }
        if (type === 'session_end') {
          const endCost = (evt.estimatedCost as number) || 0;
          const endTokens = ((evt.inputTokens as number) || 0) + ((evt.outputTokens as number) || 0);
          runningCost += endCost;
          runningTokens += endTokens;
        }

        const stats = fmtRunning();

        // Show compaction duration on first event after compaction
        if (compactionStartTime && type !== 'compaction_start') {
          const compactDuration = Math.round((Date.now() - compactionStartTime) / 1000);
          if (compactDuration > 0) {
            console.log(`         ${yellow(`⟳ Compaction completed in ${compactDuration}s`)}`);
          }
          compactionStartTime = null;
        }

        if (type === 'tool_call') {
          turnHadToolCalls = true;
          const tool = evt.toolName as string || '?';
          const fileOp = evt.fileOperation as string || '';
          const isDestructive = evt.destructive === true;
          const isWarning = evt.warning === true;
          const isSudo = evt.sudo === true;
          const ok = evt.toolSuccess ? green('✓') : red('✗');
          const fp = (evt.filePath as string) || '';
          const opLabel = fileOp ? `(${fileOp})` : '';
          const dReason = (evt.destructiveReason as string) || '';
          const wReason = (evt.warningReason as string) || '';
          const op = isSudo
            ? red(bold(`${opLabel} !sudo`))
            : isDestructive
              ? red(bold(`${opLabel} ⚠ ${dReason}`))
              : isWarning
                ? yellow(bold(`${opLabel} ⚠ ${wReason}`))
                : bold(opLabel);
          const inputSize = evt.toolInputSize ? dim(`${evt.toolInputSize}b`) : '';
          const outputSize = evt.toolOutputSize ? dim(`→ ${evt.toolOutputSize}b`) : '';

          if (debugMode) {
            // Full JSON dump
            console.log(` ${time}  ${ok} ${cyan(tool)} ${op} ${stats}`);
            const display = { ...evt };
            delete display.type; delete display.timestamp; delete display.toolName;
            console.log(dim(`         ${JSON.stringify(display, null, 2).split('\n').join('\n         ')}`));
          } else if (verboseMode) {
            // Full file path, git context, input+output sizes, line changes
            const repo = evt.gitRepo ? blue(demoMode ? DEMO_REPO : evt.gitRepo as string) : '';
            const branch = evt.gitBranch ? dim(`(${evt.gitBranch})`) : '';
            const lang = evt.language ? dim(`[${evt.language}]`) : '';
            const la = (evt.linesAdded as number) || 0;
            const lr = (evt.linesRemoved as number) || 0;
            const lineInfo = (la > 0 || lr > 0) ? ` ${green(`+${la}`)}/${red(`-${lr}`)}` : '';
            console.log(` ${time}  ${ok} ${cyan(tool.padEnd(12))} ${op} ${inputSize} ${outputSize} ${lang}${lineInfo}  ${stats}`);
            if (fp) console.log(`         ${dim('path:')} ${fp}`);
            const evtCwd = demoMode ? DEMO_PROJECT : getCwd(evt);
            if (evtCwd || repo) {
              let projLine = evtCwd ? `         ${dim('project:')} ${blue(evtCwd)}` : '        ';
              if (repo) {
                projLine += `  ${dim('repo:')} ${repo} ${branch}`;
              } else if (evt.gitBranch || evt.gitCommit) {
                const gb = evt.gitBranch ? cyan(evt.gitBranch as string) : '';
                const gc = evt.gitCommit ? dim(evt.gitCommit as string) : '';
                const gd = evt.gitDirty ? yellow('*') : '';
                projLine += `  ${gb} ${gc}${gd}`;
              }
              console.log(projLine);
            }
          } else {
            // Compact (current default)
            const shortPath = fp ? fp.split('/').slice(-2).join('/') : '';
            console.log(` ${time}  ${ok} ${cyan(tool.padEnd(8))} ${shortPath} ${op} ${inputSize}  ${stats}`);
          }
        } else if (type === 'session_start') {
          const evtCwd = demoMode ? DEMO_PROJECT : getCwd(evt);
          const isClear = evt.possibleContextClear === true || (lastSessionEndTime && (Date.now() - lastSessionEndTime) < 5000);
          const label = isClear ? `${bold('Session started')}  ${yellow('(Possible Context Clear)')}` : bold('Session started');
          console.log(` ${time}  ${green('▶')} ${label}  ${stats}`);
          if (evtCwd) {
            let projLine = `         ${dim('project:')} ${blue(evtCwd)}`;
            const gitRepo = demoMode ? DEMO_REPO : evt.gitRepo as string;
            if (gitRepo) {
              const gitBranch = evt.gitBranch ? dim(`(${evt.gitBranch as string})`) : '';
              projLine += `  ${dim('repo:')} ${blue(gitRepo)} ${gitBranch}`;
            } else if (evt.gitBranch || evt.gitCommit) {
              const gb = evt.gitBranch ? cyan(evt.gitBranch as string) : '';
              const gc = evt.gitCommit ? dim(evt.gitCommit as string) : '';
              const gd = evt.gitDirty ? yellow('*') : '';
              projLine += `  ${gb} ${gc}${gd}`;
            }
            console.log(projLine);
          }
          if (verboseMode) {
            const model = evt.model as string;
            const account = evt.account as string;
            if (model) console.log(`         ${dim('model:')} ${model}`);
            if (account) console.log(`         ${dim('account:')} ${account}`);
          }
          if (debugMode) {
            console.log(dim(`         ${JSON.stringify(evt, null, 2).split('\n').join('\n         ')}`));
          }
        } else if (type === 'session_end') {
          lastSessionEndTime = Date.now();
          console.log(` ${time}  ${red('■')} ${bold('Session ended')}  ${stats}`);
          if (verboseMode) {
            const cost = evt.estimatedCost as number;
            const tokens = ((evt.inputTokens as number) || 0) + ((evt.outputTokens as number) || 0);
            if (cost) console.log(`         ${dim('cost:')} ${yellow(`$${cost.toFixed(4)}`)}`);
            if (tokens) console.log(`         ${dim('tokens:')} ${tokens.toLocaleString()}`);
          }
          if (debugMode) {
            console.log(dim(`         ${JSON.stringify(evt, null, 2).split('\n').join('\n         ')}`));
          }
        } else if (type === 'compaction_start') {
          compactionStartTime = Date.now();
          const trigger = (evt.trigger as string) || 'auto';
          const triggerLabel = trigger === 'manual' ? yellow('/compact') : yellow('auto');
          console.log(` ${time}  ${yellow('⟳')} ${yellow(bold('Compacting conversation...'))}  ${dim(`(${triggerLabel})`)}`);
          if (debugMode && evt.customInstructions) {
            console.log(dim(`         instructions: ${evt.customInstructions}`));
          }
        } else if (type === 'turn_complete') {
          const turnLabel = turnHadToolCalls ? 'Turn complete' : 'Turn complete — text only (no tools)';
          console.log(` ${time}  ${dim('↩')} ${dim(turnLabel)}`);
          turnHadToolCalls = false;
        } else if (type === 'user_prompt') {
          if (showPrompt) {
            const promptLen = (evt.promptLength as number) || 0;
            const promptPreview = ((evt.prompt as string) || '').slice(0, 80).replace(/\n/g, ' ');
            console.log(` ${time}  ${cyan('⌨')} ${bold('Prompt')} ${dim(`(${promptLen} chars)`)} ${dim(promptPreview)}${promptLen > 80 ? dim('…') : ''}`);
          }
        } else if (type === 'pre_tool_use') {
          const tool = evt.toolName as string || '?';
          if (verboseMode) {
            console.log(` ${time}  ${dim('⏳')} ${dim(`Pre-${tool}`)}`);
          }
        } else if (type === 'permission_request') {
          const tool = evt.toolName as string || '?';
          console.log(` ${time}  ${yellow('🔒')} ${yellow('Permission requested')} ${dim(tool)}`);
        } else if (type === 'notification') {
          const nType = evt.notificationType as string || 'unknown';
          const nMsg = ((evt.notificationMessage as string) || '').slice(0, 80);
          console.log(` ${time}  ${yellow('🔔')} ${dim('Notification')} ${dim(`[${nType}]`)} ${dim(nMsg)}`);
        } else if (type === 'subagent_start') {
          const agentType = evt.agentType as string || '?';
          console.log(` ${time}  ${green('⊕')} ${bold('Subagent started')} ${cyan(agentType)}`);
        } else if (type === 'subagent_stop') {
          const agentType = evt.agentType as string || '?';
          console.log(` ${time}  ${red('⊖')} ${dim('Subagent stopped')} ${cyan(agentType)}`);
        } else if (type === 'teammate_idle') {
          const teammate = evt.teammateName as string || '?';
          console.log(` ${time}  ${dim('💤')} ${dim(`Teammate idle: ${teammate}`)}`);
        } else if (type === 'task_completed') {
          const subject = evt.taskSubject as string || '?';
          console.log(` ${time}  ${green('✓')} ${bold('Task completed')} ${dim(subject)}`);
        } else {
          console.log(` ${time}  ${dim('·')} ${dim(type)}`);
          if (debugMode) {
            console.log(dim(`         ${JSON.stringify(evt, null, 2).split('\n').join('\n         ')}`));
          }
        }
      };

      // Poll for violations from the API
      let lastViolationCheck = Date.now();
      const checkViolations = async () => {
        try {
          const res = await fetch(`${monEndpoint}/api/v1/ai/validate-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${monConfig.apiKey}` },
            body: JSON.stringify({ apiKey: monConfig.apiKey }),
            signal: AbortSignal.timeout(3000),
          });
          // We can't easily poll violations from the API endpoint without the user's session
          // So instead, watch the flush log for violation indicators
        } catch { /* silent */ }
      };

      // Watch flush log for activity
      let lastFlushSize = 0;
      const flushLog = path.join(RULECATCH_DIR, 'flush.log');
      if (fs.existsSync(flushLog)) {
        lastFlushSize = fs.statSync(flushLog).size;
      }

      const checkFlushLog = () => {
        if (!fs.existsSync(flushLog)) return;
        const stat = fs.statSync(flushLog);
        if (stat.size > lastFlushSize) {
          // Read new lines
          const fd = fs.openSync(flushLog, 'r');
          const newBytes = Buffer.alloc(stat.size - lastFlushSize);
          fs.readSync(fd, newBytes, 0, newBytes.length, lastFlushSize);
          fs.closeSync(fd);
          const newLines = newBytes.toString().trim().split('\n').filter(Boolean);
          for (const line of newLines) {
            // Parse flush log entries
            if (line.includes('Flushed') || line.includes('flushed')) {
              console.log(` ${dim(fmtDateTime(new Date()))}  ${green('↑')} ${green(line.replace(/^\[.*?\]\s*/, ''))}`);
            } else if (line.includes('Error') || line.includes('error') || line.includes('fail')) {
              // Extract clean error message from API JSON responses
              let errorMsg = line.replace(/^\[.*?\]\s*/, '');
              const jsonMatch = errorMsg.match(/\{.*\}/);
              if (jsonMatch) {
                try {
                  const parsed = JSON.parse(jsonMatch[0]);
                  errorMsg = parsed.message || parsed.error || errorMsg;
                } catch { /* use raw line */ }
              }
              console.log(` ${dim(fmtDateTime(new Date()))}  ${red('✗')} ${red(errorMsg)}`);
            }
          }
          lastFlushSize = stat.size;
        }
      };

      // Watch events.log for new events (append-only JSONL — no race with flush)
      if (!fs.existsSync(EVENTS_LOG)) {
        fs.writeFileSync(EVENTS_LOG, '');
      }

      const readNewEvents = () => {
        try {
          const stat = fs.statSync(EVENTS_LOG);
          if (stat.size > eventsLogSize) {
            const fd = fs.openSync(EVENTS_LOG, 'r');
            const newBytes = Buffer.alloc(stat.size - eventsLogSize);
            fs.readSync(fd, newBytes, 0, newBytes.length, eventsLogSize);
            fs.closeSync(fd);
            eventsLogSize = stat.size;
            const lines = newBytes.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              try {
                const evt = JSON.parse(line);
                fmtEvent(evt);
              } catch { /* skip malformed lines */ }
            }
          }
        } catch { /* file might be mid-write */ }
      };

      // Poll events.log every 500ms (fs.watch is unreliable on WSL2/Linux for file changes)
      const interval = setInterval(() => {
        readNewEvents();
        checkFlushLog();
      }, 500);

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        clearInterval(interval);
        console.log(`\n ${dim('Monitor stopped.')}\n`);
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => {});
      break;
    }

    case 'check': {
      // check --help: print help and exit 0 (used as existence check by hook scripts)
      if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Rulecatch Check - View recent rule violations

Usage:
  npx @rulecatch/ai-pooler check [options]

Options:
  --quiet          Only output the summary line (for scripting)
  --format summary Output format: summary (default), json
  --period=24h     Time window: 1h, 12h, 24h (default), 7d

Examples:
  npx @rulecatch/ai-pooler check
  npx @rulecatch/ai-pooler check --quiet --format summary
  npx @rulecatch/ai-pooler check --period=7d
`);
        break;
      }

      const checkQuiet = args.includes('--quiet') || args.includes('-q');
      const checkFlags = parseArgs();

      // Handle --format summary (space-separated) and --format=summary
      let checkFormat = checkFlags.format || 'summary';
      const formatIdx = args.indexOf('--format');
      if (formatIdx !== -1 && args[formatIdx + 1] && !args[formatIdx + 1].startsWith('--')) {
        checkFormat = args[formatIdx + 1];
      }

      const checkPeriod = checkFlags.period || '24h';

      if (!fs.existsSync(CONFIG_PATH)) {
        if (!checkQuiet) console.error(red('Not configured. Run `npx @rulecatch/ai-pooler init` first.'));
        process.exit(1);
      }

      let checkConfig: { apiKey?: string; region?: string; endpoint?: string };
      try {
        checkConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      } catch {
        if (!checkQuiet) console.error(red('Failed to read config.'));
        process.exit(1);
      }

      if (!checkConfig.apiKey) {
        if (!checkQuiet) console.error(red('No API key configured.'));
        process.exit(1);
      }

      const checkEndpoint = checkConfig.endpoint || (checkConfig.region === 'eu' ? 'https://api-eu.rulecatch.ai' : 'https://api.rulecatch.ai');

      try {
        const checkRes = await fetch(`${checkEndpoint}/api/v1/ai/violations/check?period=${checkPeriod}`, {
          headers: { 'Authorization': `Bearer ${checkConfig.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });

        if (!checkRes.ok) {
          if (!checkQuiet) console.error(red(`Failed to check violations (${checkRes.status})`));
          process.exit(1);
        }

        const checkData = await checkRes.json() as {
          total: number;
          errors: number;
          warnings: number;
          infos: number;
          summary: string;
          period: string;
        };

        if (checkFormat === 'json') {
          console.log(JSON.stringify(checkData));
        } else {
          // summary format — just the summary string
          if (checkQuiet) {
            console.log(checkData.summary);
          } else {
            console.log(`\nRulecatch Violations (${checkData.period})\n`);
            console.log(`  Total:    ${checkData.total}`);
            if (checkData.errors > 0) console.log(`  Errors:   ${red(String(checkData.errors))}`);
            if (checkData.warnings > 0) console.log(`  Warnings: ${yellow(String(checkData.warnings))}`);
            if (checkData.infos > 0) console.log(`  Info:     ${dim(String(checkData.infos))}`);
            console.log(`\n  ${checkData.summary}\n`);
          }
        }
      } catch {
        if (!checkQuiet) console.error(red('Could not connect to API.'));
        process.exit(1);
      }
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      console.log(`
Rulecatch AI Pooler - Development Analytics (Zero Token Overhead)

Usage:
  npx @rulecatch/ai-pooler [command] [options]

Commands:
  init         Interactive setup (API key, encryption, hooks)
  uninstall    Remove all Rulecatch files and hooks
  status       Check setup, buffer count, session token
  check        View recent rule violations (use --quiet --format summary for scripting)
  flush        Force send all buffered events
  logs         Show flush activity logs
  config       View or update configuration
  monitor      Live event stream — watch events + flushes in real-time (alias: live)
  backpressure Show detailed backpressure/throttling status (alias: bp)
  reactivate   Resume data collection after subscription renewal

Init Options:
  --api-key=KEY        Your Rulecatch API key (starts with dc_)
  --monitor-only       Skip API key — monitor mode only (no dashboard)
  --region=us|eu       Override region (normally auto-detected)
  --encryption-key=PWD Your encryption password (min 8 chars)
  --batch-size=20      Events before auto-flush

Config Options:
  --batch-size=30      Change batch threshold
  --region=us|eu       Change data region

Log Options:
  --lines=50           Number of log lines to show
  --source=hook        Show hook log instead of flush log

Backpressure Options:
  --reset=true         Reset backpressure state (clears backoff)

Data Flow (Zero Token Overhead):
  Hook fires -> writes JSON to ~/.claude/rulecatch/buffer/
  Flush script -> encrypts PII -> sends batch to API

Quick Start:
  npx @rulecatch/ai-pooler init
  # Follow interactive prompts, then restart Claude Code

Documentation: https://rulecatch.ai/docs
`);
      break;
    }

    default: {
      if (command) {
        console.log(red(`\nUnknown command: ${command}`));
      }
      console.log('Run `npx @rulecatch/ai-pooler help` for usage.\n');
    }
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
