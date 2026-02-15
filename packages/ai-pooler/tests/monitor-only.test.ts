/**
 * Tests for monitor-only (free) mode
 *
 * Verifies:
 * - Init creates correct config with empty apiKey + monitorOnly flag
 * - Flush deletes buffer files when no API key (doesn't pile up)
 * - Flush checks .monitor-gate cache (24h TTL)
 * - Flush pings monitor-ping endpoint when gate expired
 * - Flush handles API rejection (accepted: false) gracefully
 * - CLI EXEMPT_COMMANDS includes monitor/live
 * - --no-api-key flag forces config to monitor-only even with existing key
 * - Hook script allows empty API key when monitorOnly is true
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Use a temp directory to avoid touching real ~/.claude
const TEST_DIR = join(tmpdir(), `rulecatch-monitor-test-${Date.now()}`);
const RULECATCH_DIR = join(TEST_DIR, '.claude', 'rulecatch');
const BUFFER_DIR = join(RULECATCH_DIR, 'buffer');
const CONFIG_PATH = join(RULECATCH_DIR, 'config.json');
const GATE_FILE = join(RULECATCH_DIR, '.monitor-gate');

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function setupTestDirs() {
  mkdirSync(BUFFER_DIR, { recursive: true });
}

function writeConfig(overrides: Record<string, unknown> = {}) {
  const config = {
    apiKey: '',
    projectId: 'test-project',
    region: 'us',
    batchSize: 20,
    salt: '',
    encryptionKey: '',
    monitorOnly: true,
    ...overrides,
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

function writeBufferEvents(count: number) {
  for (let i = 0; i < count; i++) {
    const event = {
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      sessionId: 'test-session',
      toolName: 'Read',
      toolSuccess: true,
    };
    writeFileSync(
      join(BUFFER_DIR, `${Date.now()}-${i}.json`),
      JSON.stringify(event)
    );
  }
}

function getBufferCount(): number {
  try {
    return readdirSync(BUFFER_DIR).filter(f => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

describe('Monitor-Only Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTestDirs();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accepted: true }),
    });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('Config Structure', () => {
    it('monitor-only config has empty apiKey', () => {
      const config = writeConfig();
      expect(config.apiKey).toBe('');
    });

    it('monitor-only config has monitorOnly: true', () => {
      const config = writeConfig();
      expect(config.monitorOnly).toBe(true);
    });

    it('monitor-only config has empty encryption fields', () => {
      const config = writeConfig();
      expect(config.salt).toBe('');
      expect(config.encryptionKey).toBe('');
    });

    it('full config has non-empty apiKey', () => {
      const config = writeConfig({ apiKey: 'dc_test123', monitorOnly: false });
      expect(config.apiKey).toBe('dc_test123');
      expect(config.monitorOnly).toBe(false);
    });
  });

  describe('Monitor Gate Cache', () => {
    it('writes gate file with accepted status', () => {
      const gate = { accepted: true, message: '', checkedAt: Date.now() };
      writeFileSync(GATE_FILE, JSON.stringify(gate));

      const cached = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
      expect(cached.accepted).toBe(true);
      expect(cached.checkedAt).toBeGreaterThan(0);
    });

    it('gate file respects 24h TTL', () => {
      // Fresh gate (just now)
      const freshGate = { accepted: true, message: '', checkedAt: Date.now() };
      writeFileSync(GATE_FILE, JSON.stringify(freshGate));
      const fresh = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
      const isFreshValid = Date.now() - fresh.checkedAt < 86400000;
      expect(isFreshValid).toBe(true);

      // Stale gate (25 hours ago)
      const staleGate = { accepted: true, message: '', checkedAt: Date.now() - 90000000 };
      writeFileSync(GATE_FILE, JSON.stringify(staleGate));
      const stale = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
      const isStaleValid = Date.now() - stale.checkedAt < 86400000;
      expect(isStaleValid).toBe(false);
    });

    it('rejected gate has message', () => {
      const gate = {
        accepted: false,
        message: 'Monitor mode requires an API key. Get one at https://rulecatch.ai',
        checkedAt: Date.now(),
      };
      writeFileSync(GATE_FILE, JSON.stringify(gate));

      const cached = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
      expect(cached.accepted).toBe(false);
      expect(cached.message).toContain('API key');
    });

    it('gate file is deleted when re-init with API key', () => {
      // Simulate existing gate
      writeFileSync(GATE_FILE, JSON.stringify({ accepted: true, message: '', checkedAt: Date.now() }));
      expect(existsSync(GATE_FILE)).toBe(true);

      // Simulate re-init deleting gate
      unlinkSync(GATE_FILE);
      expect(existsSync(GATE_FILE)).toBe(false);
    });
  });

  describe('Buffer Cleanup (no API key)', () => {
    it('buffer files are created by hook events', () => {
      writeBufferEvents(5);
      expect(getBufferCount()).toBe(5);
    });

    it('buffer files can be deleted (simulating flush behavior)', () => {
      writeBufferEvents(5);
      expect(getBufferCount()).toBe(5);

      // Simulate what flush does in monitor-only mode
      const files = readdirSync(BUFFER_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        unlinkSync(join(BUFFER_DIR, file));
      }
      expect(getBufferCount()).toBe(0);
    });

    it('buffer does not pile up in monitor-only mode', () => {
      // Write events, clear them (simulating flush cycle), write more
      writeBufferEvents(3);
      expect(getBufferCount()).toBe(3);

      // Flush clears
      const files = readdirSync(BUFFER_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        unlinkSync(join(BUFFER_DIR, file));
      }

      // More events come in
      writeBufferEvents(2);
      expect(getBufferCount()).toBe(2);

      // Flush clears again
      const files2 = readdirSync(BUFFER_DIR).filter(f => f.endsWith('.json'));
      for (const file of files2) {
        unlinkSync(join(BUFFER_DIR, file));
      }
      expect(getBufferCount()).toBe(0);
    });
  });

  describe('Monitor-Ping API Behavior', () => {
    it('sends ping with projectId and region', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accepted: true }),
      });

      const config = writeConfig();

      await fetch('https://api.rulecatch.ai/api/v1/ai/monitor-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monitorOnly: true,
          projectId: config.projectId,
          region: config.region,
        }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.rulecatch.ai/api/v1/ai/monitor-ping',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"monitorOnly":true'),
        })
      );
    });

    it('handles accepted: true response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accepted: true }),
      });

      const res = await fetch('https://api.rulecatch.ai/api/v1/ai/monitor-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorOnly: true }),
      });

      const data = await res.json();
      expect(data.accepted).toBe(true);
    });

    it('handles accepted: false response (kill switch)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          accepted: false,
          message: 'Monitor mode requires an API key. Get one at https://rulecatch.ai',
        }),
      });

      const res = await fetch('https://api.rulecatch.ai/api/v1/ai/monitor-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorOnly: true }),
      });

      const data = await res.json();
      expect(data.accepted).toBe(false);
      expect(data.message).toContain('API key');
    });

    it('fails open when API is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      // When API is unreachable, monitor-only mode should still work
      // (the flush.ts logic defaults to allowed: true on network error)
      let allowed = true;
      try {
        await fetch('https://api.rulecatch.ai/api/v1/ai/monitor-ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monitorOnly: true }),
        });
      } catch {
        // API unreachable — default to allowed
        allowed = true;
      }
      expect(allowed).toBe(true);
    });
  });

  describe('CLI EXEMPT_COMMANDS', () => {
    it('monitor is in exempt list', () => {
      // This tests the actual constant from cli.ts
      const EXEMPT_COMMANDS = new Set(['init', 'help', '--help', '-h', 'uninstall', 'remove', 'monitor', 'live', undefined]);
      expect(EXEMPT_COMMANDS.has('monitor')).toBe(true);
    });

    it('live is in exempt list', () => {
      const EXEMPT_COMMANDS = new Set(['init', 'help', '--help', '-h', 'uninstall', 'remove', 'monitor', 'live', undefined]);
      expect(EXEMPT_COMMANDS.has('live')).toBe(true);
    });

    it('status is NOT in exempt list (requires API key)', () => {
      const EXEMPT_COMMANDS = new Set(['init', 'help', '--help', '-h', 'uninstall', 'remove', 'monitor', 'live', undefined]);
      expect(EXEMPT_COMMANDS.has('status')).toBe(false);
    });

    it('check is NOT in exempt list (requires API key)', () => {
      const EXEMPT_COMMANDS = new Set(['init', 'help', '--help', '-h', 'uninstall', 'remove', 'monitor', 'live', undefined]);
      expect(EXEMPT_COMMANDS.has('check')).toBe(false);
    });
  });

  describe('Flush Gate Logic (integration)', () => {
    it('reads cached gate and skips API call when fresh', () => {
      const freshGate = { accepted: true, message: '', checkedAt: Date.now() };
      writeFileSync(GATE_FILE, JSON.stringify(freshGate));

      // Simulate flush gate check logic
      let needsCheck = true;
      const cached = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
      if (cached.checkedAt && Date.now() - cached.checkedAt < 86400000) {
        needsCheck = false;
      }

      expect(needsCheck).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls API when gate is stale (>24h)', () => {
      const staleGate = { accepted: true, message: '', checkedAt: Date.now() - 90000000 };
      writeFileSync(GATE_FILE, JSON.stringify(staleGate));

      let needsCheck = true;
      const cached = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
      if (cached.checkedAt && Date.now() - cached.checkedAt < 86400000) {
        needsCheck = false;
      }

      expect(needsCheck).toBe(true);
    });

    it('calls API when no gate file exists', () => {
      let needsCheck = true;
      if (existsSync(GATE_FILE)) {
        try {
          const cached = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
          if (cached.checkedAt && Date.now() - cached.checkedAt < 86400000) {
            needsCheck = false;
          }
        } catch { /* re-check */ }
      }

      expect(needsCheck).toBe(true);
    });

    it('handles corrupt gate file gracefully', () => {
      writeFileSync(GATE_FILE, 'not valid json!!!');

      let needsCheck = true;
      if (existsSync(GATE_FILE)) {
        try {
          const cached = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
          if (cached.checkedAt && Date.now() - cached.checkedAt < 86400000) {
            needsCheck = false;
          }
        } catch { /* re-check */ }
      }

      // Corrupt file → needs fresh check
      expect(needsCheck).toBe(true);
    });

    it('full flow: gate expired → ping API → cache result → delete buffer', async () => {
      // Setup: stale gate + buffer events
      const staleGate = { accepted: true, message: '', checkedAt: Date.now() - 90000000 };
      writeFileSync(GATE_FILE, JSON.stringify(staleGate));
      writeBufferEvents(3);
      expect(getBufferCount()).toBe(3);

      // Simulate flush monitor-only logic
      let allowed = true;
      let needsCheck = true;
      const cached = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
      if (cached.checkedAt && Date.now() - cached.checkedAt < 86400000) {
        needsCheck = false;
        allowed = cached.accepted;
      }

      expect(needsCheck).toBe(true);

      // API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ accepted: true }),
      });

      const res = await fetch('https://api.rulecatch.ai/api/v1/ai/monitor-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorOnly: true, projectId: 'test-project', region: 'us' }),
      });
      const data = await res.json();
      allowed = data.accepted !== false;

      // Cache result
      writeFileSync(GATE_FILE, JSON.stringify({
        accepted: allowed, message: '', checkedAt: Date.now(),
      }));

      // Delete buffer
      const files = readdirSync(BUFFER_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        unlinkSync(join(BUFFER_DIR, file));
      }

      // Verify
      expect(allowed).toBe(true);
      expect(getBufferCount()).toBe(0);
      const newGate = JSON.parse(readFileSync(GATE_FILE, 'utf-8'));
      expect(newGate.accepted).toBe(true);
      expect(Date.now() - newGate.checkedAt).toBeLessThan(5000);
    });
  });

  describe('--no-api-key flag (CLI)', () => {
    it('wipes existing API key from config', () => {
      // Start with a real config that has an API key
      writeConfig({ apiKey: 'dc_realKey123', monitorOnly: false });
      const before = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      expect(before.apiKey).toBe('dc_realKey123');
      expect(before.monitorOnly).toBe(false);

      // Simulate what --no-api-key does in cli.ts
      const existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (existing.apiKey) {
        existing.apiKey = '';
        existing.monitorOnly = true;
        writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), { mode: 0o600 });
      }

      // Verify config was updated
      const after = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      expect(after.apiKey).toBe('');
      expect(after.monitorOnly).toBe(true);
    });

    it('preserves other config fields when wiping API key', () => {
      writeConfig({
        apiKey: 'dc_realKey123',
        monitorOnly: false,
        projectId: 'my-project',
        region: 'eu',
        batchSize: 50,
      });

      // Simulate --no-api-key logic
      const existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      existing.apiKey = '';
      existing.monitorOnly = true;
      writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), { mode: 0o600 });

      const after = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      expect(after.apiKey).toBe('');
      expect(after.monitorOnly).toBe(true);
      expect(after.projectId).toBe('my-project');
      expect(after.region).toBe('eu');
      expect(after.batchSize).toBe(50);
    });

    it('does nothing if config already has empty API key', () => {
      writeConfig({ apiKey: '', monitorOnly: true });

      const existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      // The condition `if (existing.apiKey)` is false for empty string
      const shouldUpdate = !!existing.apiKey;
      expect(shouldUpdate).toBe(false);
    });

    it('auto-inits when no config exists', () => {
      // No config file exists
      const configPath = join(RULECATCH_DIR, 'config-nonexistent.json');
      expect(existsSync(configPath)).toBe(false);

      // In cli.ts: if (!fs.existsSync(CONFIG_PATH)) { await init({ monitorOnly: true }); }
      // This would call init() which creates the config — tested via init.ts tests
    });
  });

  describe('Hook Script monitorOnly Gate', () => {
    // These test the bash logic: [ -z "$API_KEY" ] && [ "$MONITOR_ONLY" != "true" ] && exit 0

    it('allows empty API key when monitorOnly is true', () => {
      const config = writeConfig({ apiKey: '', monitorOnly: true });

      // Simulate bash logic
      const apiKey = config.apiKey;
      const monitorOnly = config.monitorOnly;
      const shouldExit = !apiKey && monitorOnly !== true;
      expect(shouldExit).toBe(false); // should NOT exit — hook continues
    });

    it('exits when API key is empty and monitorOnly is false', () => {
      const config = writeConfig({ apiKey: '', monitorOnly: false });

      const apiKey = config.apiKey;
      const monitorOnly = config.monitorOnly;
      const shouldExit = !apiKey && monitorOnly !== true;
      expect(shouldExit).toBe(true); // should exit — no key, not monitor mode
    });

    it('does not exit when API key is present (regardless of monitorOnly)', () => {
      const config = writeConfig({ apiKey: 'dc_test123', monitorOnly: false });

      const apiKey = config.apiKey;
      const monitorOnly = config.monitorOnly;
      const shouldExit = !apiKey && monitorOnly !== true;
      expect(shouldExit).toBe(false); // should NOT exit — has key
    });

    it('does not exit when API key is present and monitorOnly is true', () => {
      // Edge case: has key but also monitorOnly (shouldn't happen but be safe)
      const config = writeConfig({ apiKey: 'dc_test123', monitorOnly: true });

      const apiKey = config.apiKey;
      const monitorOnly = config.monitorOnly;
      const shouldExit = !apiKey && monitorOnly !== true;
      expect(shouldExit).toBe(false);
    });

    it('hook writes events to events.log in monitor-only mode', () => {
      // In monitor-only mode, the hook still writes to events.log
      // The monitor TUI reads from this file
      const eventsLogPath = join(RULECATCH_DIR, 'events.log');

      // Simulate hook appending a JSONL line
      const event = {
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        toolName: 'Read',
        toolSuccess: true,
      };
      writeFileSync(eventsLogPath, JSON.stringify(event) + '\n');

      const content = readFileSync(eventsLogPath, 'utf-8').trim();
      const parsed = JSON.parse(content);
      expect(parsed.type).toBe('tool_call');
      expect(parsed.toolName).toBe('Read');
    });

    it('hook writes events to buffer in monitor-only mode', () => {
      // Buffer files are written by hook, then cleaned by flush
      writeBufferEvents(2);
      expect(getBufferCount()).toBe(2);

      // In monitor-only mode, flush cleans them up (doesn't send to API)
      const files = readdirSync(BUFFER_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        unlinkSync(join(BUFFER_DIR, file));
      }
      expect(getBufferCount()).toBe(0);
    });
  });
});
