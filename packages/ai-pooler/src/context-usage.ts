/**
 * Context usage helpers for the monitor display.
 * Parses Claude Code transcript JSONL for real token usage
 * and renders a visual context bar.
 */

import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs';

export interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Parse the last assistant message's usage data from a transcript JSONL file.
 * Only reads the last ~20 lines for performance (< 50ms).
 */
export function parseTranscriptUsage(transcriptPath: string): TranscriptUsage | null {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;

  try {
    const stat = statSync(transcriptPath);
    // Read last chunk (enough for ~20 lines — ~40KB should cover it)
    const chunkSize = Math.min(stat.size, 40960);
    const buffer = Buffer.alloc(chunkSize);
    const fd = openSync(transcriptPath, 'r');
    readSync(fd, buffer, 0, chunkSize, Math.max(0, stat.size - chunkSize));
    closeSync(fd);

    const tail = buffer.toString('utf-8');
    const lines = tail.split('\n').filter(Boolean);

    // Take last 20 lines, search backwards for assistant message with usage
    const lastLines = lines.slice(-20);
    for (let i = lastLines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lastLines[i]);
        if (entry.type === 'assistant' && entry.message?.usage) {
          const u = entry.message.usage;
          return {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
          };
        }
      } catch { /* skip malformed lines */ }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get context window size for a given model name.
 * All current Claude models use 200K. Extensible for future models.
 */
export function getContextWindowSize(model: string): number {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 200000;
  if (m.includes('sonnet')) return 200000;
  if (m.includes('haiku')) return 200000;
  return 200000; // default
}

/**
 * Format a token count with K/M suffix.
 */
export function fmtTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${tokens}`;
}

/**
 * Get the color function name for a context usage percentage.
 * green < 50%, yellow 50-80%, red > 80%
 */
export function getContextColor(percentage: number): 'green' | 'yellow' | 'red' {
  if (percentage > 80) return 'red';
  if (percentage >= 50) return 'yellow';
  return 'green';
}

/**
 * Render a visual context bar.
 * Returns null if no usage data available.
 *
 * Format: [████████░░ 78% | 156K/200K]
 * Bar width: 10 chars
 */
export function formatContextBar(
  usage: TranscriptUsage | null,
  windowSize: number,
): { bar: string; percentage: number; color: 'green' | 'yellow' | 'red' } | null {
  if (!usage) return null;

  const BAR_WIDTH = 10;
  // Total context = input_tokens + cache_creation + cache_read (all sent to API)
  const total = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  const pct = Math.min(100, Math.round((total / windowSize) * 100));
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;

  const bar = `[${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}% | ${fmtTokens(total)}/${fmtTokens(windowSize)}]`;
  const color = getContextColor(pct);

  return { bar, percentage: pct, color };
}
