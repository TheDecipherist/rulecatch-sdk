/**
 * Tests for monitor context usage display
 *
 * Verifies:
 * - Transcript JSONL parsing extracts usage data from assistant messages
 * - Model-to-context-window mapping returns correct sizes
 * - Context bar rendering with correct fill, color, and formatting
 * - Edge cases: no usage data, empty transcript, malformed lines
 * - Token formatting (K/M suffixes)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseTranscriptUsage,
  getContextWindowSize,
  formatContextBar,
  fmtTokens,
  getContextColor,
} from '../src/context-usage.js';

const TEST_DIR = join(tmpdir(), `rulecatch-context-test-${Date.now()}`);

function setupTestDir() {
  mkdirSync(TEST_DIR, { recursive: true });
}

/** Write a transcript JSONL file with lines */
function writeTranscript(lines: object[]) {
  const path = join(TEST_DIR, 'transcript.jsonl');
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return path;
}

/** Create a mock assistant message with usage data */
function mockAssistantMessage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}) {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      type: 'message',
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      },
    },
  };
}

function mockUserMessage(content: string) {
  return { type: 'user', message: { role: 'user', content } };
}

function mockProgressMessage() {
  return { type: 'progress', data: { type: 'hook_progress' } };
}

describe('Monitor Context Usage', () => {
  beforeEach(() => setupTestDir());
  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('Transcript Parsing', () => {
    it('should extract usage from last assistant message', () => {
      const path = writeTranscript([
        mockAssistantMessage({ input_tokens: 50000, output_tokens: 1200 }),
        mockUserMessage('hello'),
        mockAssistantMessage({ input_tokens: 156000, output_tokens: 3400, cache_read_input_tokens: 120000 }),
      ]);
      const result = parseTranscriptUsage(path);
      expect(result).not.toBeNull();
      expect(result!.inputTokens).toBe(156000);
      expect(result!.outputTokens).toBe(3400);
      expect(result!.cacheReadTokens).toBe(120000);
    });

    it('should skip non-assistant messages when searching for usage', () => {
      const path = writeTranscript([
        mockAssistantMessage({ input_tokens: 80000, output_tokens: 500 }),
        mockUserMessage('do something'),
        mockProgressMessage(),
        mockUserMessage('another prompt'),
      ]);
      const result = parseTranscriptUsage(path);
      expect(result).not.toBeNull();
      expect(result!.inputTokens).toBe(80000);
    });

    it('should return null when transcript has no assistant messages', () => {
      const path = writeTranscript([
        mockUserMessage('hello'),
        mockProgressMessage(),
      ]);
      const result = parseTranscriptUsage(path);
      expect(result).toBeNull();
    });

    it('should return null when transcript file does not exist', () => {
      const result = parseTranscriptUsage('/nonexistent/path/transcript.jsonl');
      expect(result).toBeNull();
    });

    it('should handle malformed JSONL lines gracefully', () => {
      const path = join(TEST_DIR, 'transcript.jsonl');
      const lines = [
        JSON.stringify(mockAssistantMessage({ input_tokens: 42000, output_tokens: 800 })),
        'this is not valid json {{{',
        '{"broken": true',
        JSON.stringify(mockUserMessage('test')),
      ];
      writeFileSync(path, lines.join('\n') + '\n');
      const result = parseTranscriptUsage(path);
      expect(result).not.toBeNull();
      expect(result!.inputTokens).toBe(42000);
    });

    it('should only read last 20 lines for performance', () => {
      // Write 50 lines — first 30 have old usage, last 20 have new usage
      const lines: object[] = [];
      for (let i = 0; i < 30; i++) {
        lines.push(mockAssistantMessage({ input_tokens: 1000 + i, output_tokens: 100 }));
      }
      for (let i = 0; i < 18; i++) {
        lines.push(mockUserMessage(`message ${i}`));
      }
      lines.push(mockAssistantMessage({ input_tokens: 99999, output_tokens: 500 }));
      lines.push(mockUserMessage('final'));

      const path = writeTranscript(lines);
      const result = parseTranscriptUsage(path);
      expect(result).not.toBeNull();
      expect(result!.inputTokens).toBe(99999);
    });

    it('should extract cache_creation and cache_read tokens', () => {
      const path = writeTranscript([
        mockAssistantMessage({
          input_tokens: 40000,
          output_tokens: 1000,
          cache_creation_input_tokens: 34000,
          cache_read_input_tokens: 6000,
        }),
      ]);
      const result = parseTranscriptUsage(path);
      expect(result).not.toBeNull();
      expect(result!.cacheCreationTokens).toBe(34000);
      expect(result!.cacheReadTokens).toBe(6000);
      expect(result!.inputTokens).toBe(40000);
      expect(result!.outputTokens).toBe(1000);
    });
  });

  describe('Model Context Window Mapping', () => {
    it('should return 200000 for opus models', () => {
      expect(getContextWindowSize('claude-opus-4-6')).toBe(200000);
      expect(getContextWindowSize('claude-opus-4-5-20251001')).toBe(200000);
    });

    it('should return 200000 for sonnet models', () => {
      expect(getContextWindowSize('claude-sonnet-4-6')).toBe(200000);
      expect(getContextWindowSize('claude-sonnet-4-5-20251001')).toBe(200000);
    });

    it('should return 200000 for haiku models', () => {
      expect(getContextWindowSize('claude-haiku-4-5-20251001')).toBe(200000);
    });

    it('should return 200000 for unknown models (default)', () => {
      expect(getContextWindowSize('some-future-model')).toBe(200000);
      expect(getContextWindowSize('')).toBe(200000);
    });

    it('should be case-insensitive', () => {
      expect(getContextWindowSize('Claude-OPUS-4-6')).toBe(200000);
      expect(getContextWindowSize('CLAUDE-SONNET-4-6')).toBe(200000);
    });
  });

  describe('Context Bar Rendering', () => {
    it('should render correct bar at 0%', () => {
      const result = formatContextBar(
        { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        200000,
      );
      expect(result).not.toBeNull();
      expect(result!.percentage).toBe(0);
      expect(result!.bar).toContain('0%');
      expect(result!.bar).toContain('░░░░░░░░░░');
      expect(result!.color).toBe('green');
    });

    it('should render correct bar at 50%', () => {
      // Total = input(1) + cacheCreation(0) + cacheRead(99999) = 100000
      const result = formatContextBar(
        { inputTokens: 1, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 99999 },
        200000,
      );
      expect(result).not.toBeNull();
      expect(result!.percentage).toBe(50);
      expect(result!.bar).toContain('█████░░░░░');
      expect(result!.bar).toContain('50%');
      expect(result!.color).toBe('yellow');
    });

    it('should render correct bar at 78%', () => {
      // Total = 1 + 344 + 155655 = 156000
      const result = formatContextBar(
        { inputTokens: 1, outputTokens: 3000, cacheCreationTokens: 344, cacheReadTokens: 155655 },
        200000,
      );
      expect(result).not.toBeNull();
      expect(result!.percentage).toBe(78);
      expect(result!.bar).toContain('78%');
      expect(result!.bar).toContain('156.0K/200.0K');
      expect(result!.color).toBe('yellow');
    });

    it('should render correct bar at 100%', () => {
      // Total = 1 + 500 + 199499 = 200000
      const result = formatContextBar(
        { inputTokens: 1, outputTokens: 5000, cacheCreationTokens: 500, cacheReadTokens: 199499 },
        200000,
      );
      expect(result).not.toBeNull();
      expect(result!.percentage).toBe(100);
      expect(result!.bar).toContain('██████████');
      expect(result!.color).toBe('red');
    });

    it('should cap at 100% when tokens exceed window', () => {
      // Total = 1 + 1000 + 249000 = 250001 > 200000
      const result = formatContextBar(
        { inputTokens: 1, outputTokens: 5000, cacheCreationTokens: 1000, cacheReadTokens: 249000 },
        200000,
      );
      expect(result).not.toBeNull();
      expect(result!.percentage).toBe(100);
      expect(result!.bar).toContain('██████████');
    });

    it('should show no bar when no context data available', () => {
      const result = formatContextBar(null, 200000);
      expect(result).toBeNull();
    });
  });

  describe('Token Formatting', () => {
    it('should format < 1000 as raw number', () => {
      expect(fmtTokens(500)).toBe('500');
      expect(fmtTokens(0)).toBe('0');
      expect(fmtTokens(999)).toBe('999');
    });

    it('should format 1000-999999 with K suffix', () => {
      expect(fmtTokens(1000)).toBe('1.0K');
      expect(fmtTokens(50000)).toBe('50.0K');
      expect(fmtTokens(999999)).toBe('1000.0K');
    });

    it('should format >= 1000000 with M suffix', () => {
      expect(fmtTokens(1000000)).toBe('1.0M');
      expect(fmtTokens(2500000)).toBe('2.5M');
    });

    it('should format 156000 as 156.0K', () => {
      expect(fmtTokens(156000)).toBe('156.0K');
    });

    it('should format 200000 as 200.0K', () => {
      expect(fmtTokens(200000)).toBe('200.0K');
    });
  });

  describe('Color Thresholds', () => {
    it('should return green for < 50%', () => {
      expect(getContextColor(0)).toBe('green');
      expect(getContextColor(25)).toBe('green');
      expect(getContextColor(49)).toBe('green');
    });

    it('should return yellow for 50-80%', () => {
      expect(getContextColor(50)).toBe('yellow');
      expect(getContextColor(65)).toBe('yellow');
      expect(getContextColor(80)).toBe('yellow');
    });

    it('should return red for > 80%', () => {
      expect(getContextColor(81)).toBe('red');
      expect(getContextColor(95)).toBe('red');
    });

    it('should return green for exactly 0%', () => {
      expect(getContextColor(0)).toBe('green');
    });

    it('should return red for exactly 100%', () => {
      expect(getContextColor(100)).toBe('red');
    });
  });
});
