/**
 * Backpressure & Flow Control for Rulecatch AI Pooler
 *
 * Implements smart throttling that:
 * 1. Asks server "how much can I send?" before flushing
 * 2. Respects rate limits (429) with exponential backoff
 * 3. Gradually drains buffer when server recovers
 * 4. Prevents thundering herd after outages
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Paths
const RULECATCH_DIR = join(homedir(), '.claude', 'rulecatch');
const BACKPRESSURE_STATE_FILE = join(RULECATCH_DIR, '.backpressure-state');
const LOG_FILE = join(RULECATCH_DIR, 'flush.log');

// API version
const API_VERSION = '/api/v1';

/**
 * Server's response telling us how much we can send
 */
export interface CapacityResponse {
  /** Whether server is ready to receive */
  ready: boolean;
  /** Maximum events to send in one batch */
  maxBatchSize: number;
  /** Milliseconds to wait between batches */
  delayBetweenBatches: number;
  /** If not ready, seconds to wait before asking again */
  retryAfter: number;
  /** Server load indicator (0-100) */
  loadPercent?: number;
  /** Optional message from server */
  message?: string;
}

/**
 * Local backpressure state (persisted across flush runs)
 */
export interface BackpressureState {
  /** Current backoff level (0 = no backoff, increases on failures) */
  backoffLevel: number;
  /** Timestamp when we can next attempt a flush */
  nextAttemptAfter: number;
  /** Last known server capacity */
  lastCapacity: CapacityResponse | null;
  /** Consecutive failure count */
  consecutiveFailures: number;
  /** Last successful flush timestamp */
  lastSuccessTime: number;
  /** Total events waiting in buffer (for monitoring) */
  pendingEventCount: number;
}

/**
 * Default capacity when server is unreachable
 */
const DEFAULT_CAPACITY: CapacityResponse = {
  ready: false,
  maxBatchSize: 10,
  delayBetweenBatches: 5000,
  retryAfter: 30,
};

/**
 * Backoff configuration
 */
const BACKOFF_CONFIG = {
  /** Base delay in ms */
  baseDelay: 1000,
  /** Maximum delay in ms (5 minutes) */
  maxDelay: 300000,
  /** Multiplier for each failure */
  multiplier: 2,
  /** Max consecutive failures before circuit breaker */
  maxFailures: 10,
  /** Time window to reset failure count after success (ms) */
  resetWindow: 60000,
};

function log(message: string): void {
  const timestamp = new Date().toISOString();
  try {
    appendFileSync(LOG_FILE, `[${timestamp}] [backpressure] ${message}\n`);
  } catch {
    // Ignore
  }
}

function getBaseUrl(region: string, endpointOverride?: string): string {
  // Allow override for local testing (e.g., RULECATCH_API_URL=http://localhost:3001)
  if (process.env.RULECATCH_API_URL) {
    return process.env.RULECATCH_API_URL;
  }
  if (endpointOverride) {
    return endpointOverride;
  }
  return region === 'eu'
    ? 'https://api-eu.rulecatch.ai'
    : 'https://api.rulecatch.ai';
}

/**
 * Load persisted backpressure state
 */
export function loadState(): BackpressureState {
  try {
    if (existsSync(BACKPRESSURE_STATE_FILE)) {
      const content = readFileSync(BACKPRESSURE_STATE_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Corrupt state, start fresh
  }

  return {
    backoffLevel: 0,
    nextAttemptAfter: 0,
    lastCapacity: null,
    consecutiveFailures: 0,
    lastSuccessTime: 0,
    pendingEventCount: 0,
  };
}

/**
 * Save backpressure state
 */
export function saveState(state: BackpressureState): void {
  try {
    writeFileSync(BACKPRESSURE_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    log('Failed to save backpressure state');
  }
}

/**
 * Calculate backoff delay based on failure count
 */
export function calculateBackoffDelay(backoffLevel: number): number {
  const delay = BACKOFF_CONFIG.baseDelay * Math.pow(BACKOFF_CONFIG.multiplier, backoffLevel);
  return Math.min(delay, BACKOFF_CONFIG.maxDelay);
}

/**
 * Check if we're allowed to attempt a flush
 */
export function canAttemptFlush(state: BackpressureState): { allowed: boolean; waitMs: number; reason: string } {
  const now = Date.now();

  // Check circuit breaker
  if (state.consecutiveFailures >= BACKOFF_CONFIG.maxFailures) {
    const waitMs = state.nextAttemptAfter - now;
    if (waitMs > 0) {
      return {
        allowed: false,
        waitMs,
        reason: `Circuit breaker open: ${state.consecutiveFailures} consecutive failures. Retry in ${Math.ceil(waitMs / 1000)}s`,
      };
    }
  }

  // Check backoff timer
  if (state.nextAttemptAfter > now) {
    const waitMs = state.nextAttemptAfter - now;
    return {
      allowed: false,
      waitMs,
      reason: `Backing off: retry in ${Math.ceil(waitMs / 1000)}s (level ${state.backoffLevel})`,
    };
  }

  return { allowed: true, waitMs: 0, reason: 'OK' };
}

/**
 * Ask server how much we can send
 */
export async function getServerCapacity(
  apiKey: string,
  region: string,
  sessionToken: string | null,
  pendingCount: number,
  endpointOverride?: string
): Promise<CapacityResponse> {
  const baseUrl = getBaseUrl(region, endpointOverride);
  const endpoint = `${baseUrl}${API_VERSION}/ai/pooler/capacity`;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    if (sessionToken) {
      headers['X-Pooler-Token'] = sessionToken;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pendingEventCount: pendingCount,
        clientVersion: '0.4.0',
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (response.status === 429) {
      // Rate limited - parse Retry-After header
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      log(`Rate limited by server, retry after ${retryAfter}s`);
      return {
        ready: false,
        maxBatchSize: 0,
        delayBetweenBatches: 0,
        retryAfter,
        message: 'Rate limited',
      };
    }

    if (response.status === 503) {
      // Server overloaded
      const retryAfter = parseInt(response.headers.get('Retry-After') || '120', 10);
      log(`Server overloaded, retry after ${retryAfter}s`);
      return {
        ready: false,
        maxBatchSize: 0,
        delayBetweenBatches: 0,
        retryAfter,
        message: 'Server overloaded',
      };
    }

    if (!response.ok) {
      log(`Capacity check failed: ${response.status}`);
      return DEFAULT_CAPACITY;
    }

    const data = await response.json() as CapacityResponse;
    log(`Server capacity: ready=${data.ready}, maxBatch=${data.maxBatchSize}, delay=${data.delayBetweenBatches}ms, load=${data.loadPercent}%`);
    return data;
  } catch (err) {
    log(`Failed to get server capacity: ${err}`);
    return DEFAULT_CAPACITY;
  }
}

/**
 * Record a successful flush
 */
export function recordSuccess(state: BackpressureState, eventsSent: number): BackpressureState {
  const now = Date.now();

  // Reset backoff on success
  const newState: BackpressureState = {
    ...state,
    backoffLevel: Math.max(0, state.backoffLevel - 1), // Gradually reduce backoff
    consecutiveFailures: 0,
    lastSuccessTime: now,
    nextAttemptAfter: 0, // Can attempt immediately
    pendingEventCount: Math.max(0, state.pendingEventCount - eventsSent),
  };

  log(`Success: sent ${eventsSent} events, backoff level now ${newState.backoffLevel}`);
  return newState;
}

/**
 * Record a failed flush attempt
 */
export function recordFailure(
  state: BackpressureState,
  statusCode: number,
  retryAfterHeader?: string
): BackpressureState {
  const now = Date.now();
  const newFailureCount = state.consecutiveFailures + 1;
  const newBackoffLevel = Math.min(state.backoffLevel + 1, 10); // Cap at level 10

  let nextAttemptDelay: number;

  // If server provided Retry-After, use that
  if (retryAfterHeader) {
    nextAttemptDelay = parseInt(retryAfterHeader, 10) * 1000;
  } else if (statusCode === 429 || statusCode === 503) {
    // Rate limited or overloaded - use longer delay
    nextAttemptDelay = calculateBackoffDelay(newBackoffLevel) * 2;
  } else {
    // Other error - standard backoff
    nextAttemptDelay = calculateBackoffDelay(newBackoffLevel);
  }

  const newState: BackpressureState = {
    ...state,
    backoffLevel: newBackoffLevel,
    consecutiveFailures: newFailureCount,
    nextAttemptAfter: now + nextAttemptDelay,
  };

  log(`Failure (${statusCode}): count=${newFailureCount}, backoff level=${newBackoffLevel}, retry in ${Math.ceil(nextAttemptDelay / 1000)}s`);
  return newState;
}

/**
 * Update pending event count
 */
export function updatePendingCount(state: BackpressureState, count: number): BackpressureState {
  return { ...state, pendingEventCount: count };
}

/**
 * Get human-readable status for CLI
 */
export function getStatusSummary(state: BackpressureState): string {
  const lines: string[] = [];

  if (state.consecutiveFailures > 0) {
    lines.push(`Consecutive failures: ${state.consecutiveFailures}`);
  }

  if (state.backoffLevel > 0) {
    lines.push(`Backoff level: ${state.backoffLevel}/10`);
  }

  if (state.nextAttemptAfter > Date.now()) {
    const waitSec = Math.ceil((state.nextAttemptAfter - Date.now()) / 1000);
    lines.push(`Next attempt in: ${waitSec}s`);
  }

  if (state.pendingEventCount > 0) {
    lines.push(`Pending events: ${state.pendingEventCount}`);
  }

  if (state.lastSuccessTime > 0) {
    const ago = Math.floor((Date.now() - state.lastSuccessTime) / 1000);
    lines.push(`Last success: ${ago}s ago`);
  }

  if (state.lastCapacity) {
    lines.push(`Server load: ${state.lastCapacity.loadPercent || 'unknown'}%`);
    lines.push(`Max batch: ${state.lastCapacity.maxBatchSize}`);
  }

  return lines.length > 0 ? lines.join('\n') : 'Healthy (no backpressure)';
}

/**
 * Flush events with backpressure control
 * Returns: { success: boolean, sent: number, remaining: number }
 */
export async function flushWithBackpressure(options: {
  apiKey: string;
  region: string;
  sessionToken: string | null;
  events: Record<string, unknown>[];
  sendBatch: (events: Record<string, unknown>[]) => Promise<{ ok: boolean; status: number; retryAfter?: string }>;
}): Promise<{ success: boolean; sent: number; remaining: number; state: BackpressureState }> {
  const { apiKey, region, sessionToken, events, sendBatch } = options;

  let state = loadState();
  state = updatePendingCount(state, events.length);

  // Check if we can attempt
  const canAttempt = canAttemptFlush(state);
  if (!canAttempt.allowed) {
    log(canAttempt.reason);
    saveState(state);
    return { success: false, sent: 0, remaining: events.length, state };
  }

  // Ask server how much we can send
  const capacity = await getServerCapacity(apiKey, region, sessionToken, events.length);
  state.lastCapacity = capacity;

  if (!capacity.ready) {
    // Server not ready - back off
    state.nextAttemptAfter = Date.now() + (capacity.retryAfter * 1000);
    log(`Server not ready: ${capacity.message || 'backing off'}`);
    saveState(state);
    return { success: false, sent: 0, remaining: events.length, state };
  }

  // Send in batches with controlled pace
  let totalSent = 0;
  let remainingEvents = [...events];

  while (remainingEvents.length > 0) {
    // Take a batch
    const batchSize = Math.min(capacity.maxBatchSize, remainingEvents.length);
    const batch = remainingEvents.slice(0, batchSize);

    log(`Sending batch of ${batch.length} events (${remainingEvents.length - batchSize} remaining)`);

    const result = await sendBatch(batch);

    if (result.ok) {
      // Success - remove sent events
      remainingEvents = remainingEvents.slice(batchSize);
      totalSent += batch.length;
      state = recordSuccess(state, batch.length);

      // If more events, wait before next batch
      if (remainingEvents.length > 0 && capacity.delayBetweenBatches > 0) {
        log(`Waiting ${capacity.delayBetweenBatches}ms before next batch`);
        await new Promise(resolve => setTimeout(resolve, capacity.delayBetweenBatches));

        // Re-check capacity periodically during large drains
        if (totalSent % 100 === 0) {
          const newCapacity = await getServerCapacity(apiKey, region, sessionToken, remainingEvents.length);
          state.lastCapacity = newCapacity;

          if (!newCapacity.ready) {
            log('Server requested pause during drain');
            break;
          }
        }
      }
    } else {
      // Failure - record and stop
      state = recordFailure(state, result.status, result.retryAfter);
      break;
    }
  }

  state = updatePendingCount(state, remainingEvents.length);
  saveState(state);

  return {
    success: remainingEvents.length === 0,
    sent: totalSent,
    remaining: remainingEvents.length,
    state,
  };
}
