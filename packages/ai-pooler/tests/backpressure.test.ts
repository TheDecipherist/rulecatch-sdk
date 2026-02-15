import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateBackoffDelay,
  canAttemptFlush,
  recordSuccess,
  recordFailure,
  updatePendingCount,
  getStatusSummary,
  type BackpressureState,
} from '../src/backpressure.js';

describe('backpressure', () => {
  let initialState: BackpressureState;

  beforeEach(() => {
    initialState = {
      backoffLevel: 0,
      nextAttemptAfter: 0,
      lastCapacity: null,
      consecutiveFailures: 0,
      lastSuccessTime: 0,
      pendingEventCount: 0,
    };
  });

  describe('calculateBackoffDelay', () => {
    it('level 0 = 1000ms (base delay)', () => {
      const delay = calculateBackoffDelay(0);
      expect(delay).toBe(1000);
    });

    it('level 1 = 2000ms (base * 2^1)', () => {
      const delay = calculateBackoffDelay(1);
      expect(delay).toBe(2000);
    });

    it('level 2 = 4000ms (base * 2^2)', () => {
      const delay = calculateBackoffDelay(2);
      expect(delay).toBe(4000);
    });

    it('level 3 = 8000ms (base * 2^3)', () => {
      const delay = calculateBackoffDelay(3);
      expect(delay).toBe(8000);
    });

    it('level 5 = 32000ms (base * 2^5)', () => {
      const delay = calculateBackoffDelay(5);
      expect(delay).toBe(32000);
    });

    it('level 10 = 1024000ms (base * 2^10, but capped)', () => {
      const delay = calculateBackoffDelay(10);
      // Base delay * 2^10 = 1000 * 1024 = 1024000
      // But should be capped at maxDelay (300000ms)
      expect(delay).toBe(300000);
    });

    it('caps at maxDelay (300000ms)', () => {
      const delay = calculateBackoffDelay(15);
      expect(delay).toBe(300000);
    });

    it('increases exponentially with each level', () => {
      const delay0 = calculateBackoffDelay(0);
      const delay1 = calculateBackoffDelay(1);
      const delay2 = calculateBackoffDelay(2);

      expect(delay1).toBe(delay0 * 2);
      expect(delay2).toBe(delay1 * 2);
    });
  });

  describe('canAttemptFlush', () => {
    it('returns allowed when no backoff', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 0,
        nextAttemptAfter: 0,
        consecutiveFailures: 0,
      };

      const result = canAttemptFlush(state);

      expect(result.allowed).toBe(true);
      expect(result.waitMs).toBe(0);
      expect(result.reason).toBe('OK');
    });

    it('returns not allowed when nextAttemptAfter is in the future', () => {
      const futureTime = Date.now() + 5000; // 5 seconds from now
      const state: BackpressureState = {
        ...initialState,
        nextAttemptAfter: futureTime,
        backoffLevel: 2,
      };

      const result = canAttemptFlush(state);

      expect(result.allowed).toBe(false);
      expect(result.waitMs).toBeGreaterThan(0);
      expect(result.waitMs).toBeLessThanOrEqual(5000);
      expect(result.reason).toContain('Backing off');
      expect(result.reason).toContain('level 2');
    });

    it('returns allowed when nextAttemptAfter is in the past', () => {
      const pastTime = Date.now() - 1000; // 1 second ago
      const state: BackpressureState = {
        ...initialState,
        nextAttemptAfter: pastTime,
        consecutiveFailures: 2,
        backoffLevel: 1,
      };

      const result = canAttemptFlush(state);

      expect(result.allowed).toBe(true);
      expect(result.waitMs).toBe(0);
    });

    it('returns not allowed when circuit breaker (10+ failures)', () => {
      const futureTime = Date.now() + 10000;
      const state: BackpressureState = {
        ...initialState,
        consecutiveFailures: 10,
        nextAttemptAfter: futureTime,
        backoffLevel: 5,
      };

      const result = canAttemptFlush(state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Circuit breaker open');
      expect(result.reason).toContain('10 consecutive failures');
    });

    it('allows when circuit breaker time expires', () => {
      const pastTime = Date.now() - 1000;
      const state: BackpressureState = {
        ...initialState,
        consecutiveFailures: 10, // Circuit breaker threshold
        nextAttemptAfter: pastTime, // But time has passed
      };

      const result = canAttemptFlush(state);

      expect(result.allowed).toBe(true);
    });

    it('circuit breaker check happens before backoff check', () => {
      const futureTime = Date.now() + 5000;
      const state: BackpressureState = {
        ...initialState,
        consecutiveFailures: 15, // Circuit breaker
        nextAttemptAfter: futureTime,
        backoffLevel: 2,
      };

      const result = canAttemptFlush(state);

      // Should mention circuit breaker, not just backoff
      expect(result.reason).toContain('Circuit breaker');
      expect(result.reason).toContain('15 consecutive failures');
    });
  });

  describe('recordSuccess', () => {
    it('decrements backoffLevel', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 3,
      };

      const newState = recordSuccess(state, 10);

      expect(newState.backoffLevel).toBe(2);
    });

    it('does not go below 0 backoffLevel', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 0,
      };

      const newState = recordSuccess(state, 5);

      expect(newState.backoffLevel).toBe(0);
    });

    it('resets consecutiveFailures', () => {
      const state: BackpressureState = {
        ...initialState,
        consecutiveFailures: 5,
        backoffLevel: 3,
      };

      const newState = recordSuccess(state, 10);

      expect(newState.consecutiveFailures).toBe(0);
    });

    it('decrements pendingEventCount by eventsSent', () => {
      const state: BackpressureState = {
        ...initialState,
        pendingEventCount: 50,
      };

      const newState = recordSuccess(state, 20);

      expect(newState.pendingEventCount).toBe(30);
    });

    it('does not go below 0 pendingEventCount', () => {
      const state: BackpressureState = {
        ...initialState,
        pendingEventCount: 10,
      };

      const newState = recordSuccess(state, 20);

      expect(newState.pendingEventCount).toBe(0);
    });

    it('sets lastSuccessTime to now', () => {
      const before = Date.now();
      const newState = recordSuccess(initialState, 5);
      const after = Date.now();

      expect(newState.lastSuccessTime).toBeGreaterThanOrEqual(before);
      expect(newState.lastSuccessTime).toBeLessThanOrEqual(after);
    });

    it('resets nextAttemptAfter to 0 (can attempt immediately)', () => {
      const state: BackpressureState = {
        ...initialState,
        nextAttemptAfter: Date.now() + 5000,
      };

      const newState = recordSuccess(state, 10);

      expect(newState.nextAttemptAfter).toBe(0);
    });
  });

  describe('recordFailure', () => {
    it('increments consecutiveFailures', () => {
      const state: BackpressureState = {
        ...initialState,
        consecutiveFailures: 2,
      };

      const newState = recordFailure(state, 500);

      expect(newState.consecutiveFailures).toBe(3);
    });

    it('increments backoffLevel', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 2,
      };

      const newState = recordFailure(state, 500);

      expect(newState.backoffLevel).toBe(3);
    });

    it('caps backoffLevel at 10', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 10,
      };

      const newState = recordFailure(state, 500);

      expect(newState.backoffLevel).toBe(10);
    });

    it('uses retryAfterHeader when provided', () => {
      const before = Date.now();
      const newState = recordFailure(initialState, 429, '30');
      const after = Date.now();

      // Should retry after 30 seconds (30000ms)
      const expectedTime = before + 30000;
      expect(newState.nextAttemptAfter).toBeGreaterThanOrEqual(expectedTime);
      expect(newState.nextAttemptAfter).toBeLessThanOrEqual(expectedTime + (after - before));
    });

    it('doubles delay for 429 (rate limit)', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 0, // Will become level 1 (2000ms base delay)
      };

      const before = Date.now();
      const newState = recordFailure(state, 429);

      // Level 1 = 2000ms, doubled = 4000ms
      const expectedTime = before + 4000;
      expect(newState.nextAttemptAfter).toBeGreaterThanOrEqual(expectedTime - 10);
      expect(newState.nextAttemptAfter).toBeLessThanOrEqual(expectedTime + 10);
    });

    it('doubles delay for 503 (overloaded)', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 1, // Will become level 2 (4000ms base delay)
      };

      const before = Date.now();
      const newState = recordFailure(state, 503);

      // Level 2 = 4000ms, doubled = 8000ms
      const expectedTime = before + 8000;
      expect(newState.nextAttemptAfter).toBeGreaterThanOrEqual(expectedTime - 10);
      expect(newState.nextAttemptAfter).toBeLessThanOrEqual(expectedTime + 10);
    });

    it('uses standard backoff for other status codes', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 0, // Will become level 1
      };

      const before = Date.now();
      const newState = recordFailure(state, 500);

      // Level 1 = 2000ms (not doubled)
      const expectedTime = before + 2000;
      expect(newState.nextAttemptAfter).toBeGreaterThanOrEqual(expectedTime - 10);
      expect(newState.nextAttemptAfter).toBeLessThanOrEqual(expectedTime + 10);
    });

    it('retryAfterHeader takes precedence over status code', () => {
      const before = Date.now();
      // Even though 429 would double the delay, retryAfter overrides
      const newState = recordFailure(initialState, 429, '60');

      const expectedTime = before + 60000;
      expect(newState.nextAttemptAfter).toBeGreaterThanOrEqual(expectedTime - 10);
      expect(newState.nextAttemptAfter).toBeLessThanOrEqual(expectedTime + 10);
    });
  });

  describe('updatePendingCount', () => {
    it('sets pendingEventCount', () => {
      const state: BackpressureState = {
        ...initialState,
        pendingEventCount: 10,
      };

      const newState = updatePendingCount(state, 25);

      expect(newState.pendingEventCount).toBe(25);
    });

    it('can set to 0', () => {
      const state: BackpressureState = {
        ...initialState,
        pendingEventCount: 50,
      };

      const newState = updatePendingCount(state, 0);

      expect(newState.pendingEventCount).toBe(0);
    });

    it('preserves other state fields', () => {
      const state: BackpressureState = {
        ...initialState,
        backoffLevel: 3,
        consecutiveFailures: 5,
        pendingEventCount: 10,
      };

      const newState = updatePendingCount(state, 100);

      expect(newState.backoffLevel).toBe(3);
      expect(newState.consecutiveFailures).toBe(5);
      expect(newState.pendingEventCount).toBe(100);
    });
  });

  describe('getStatusSummary', () => {
    it('returns "Healthy" for fresh state', () => {
      const state: BackpressureState = {
        ...initialState,
      };

      const summary = getStatusSummary(state);

      expect(summary).toBe('Healthy (no backpressure)');
    });

    it('includes failure info when backoff active', () => {
      const state: BackpressureState = {
        ...initialState,
        consecutiveFailures: 3,
        backoffLevel: 2,
      };

      const summary = getStatusSummary(state);

      expect(summary).toContain('Consecutive failures: 3');
      expect(summary).toContain('Backoff level: 2/10');
    });

    it('includes next attempt time when backing off', () => {
      const state: BackpressureState = {
        ...initialState,
        nextAttemptAfter: Date.now() + 5000,
        backoffLevel: 2,
      };

      const summary = getStatusSummary(state);

      expect(summary).toContain('Next attempt in:');
      expect(summary).toMatch(/\d+s/);
    });

    it('includes pending event count', () => {
      const state: BackpressureState = {
        ...initialState,
        pendingEventCount: 42,
      };

      const summary = getStatusSummary(state);

      expect(summary).toContain('Pending events: 42');
    });

    it('includes last success time', () => {
      const state: BackpressureState = {
        ...initialState,
        lastSuccessTime: Date.now() - 30000, // 30 seconds ago
      };

      const summary = getStatusSummary(state);

      expect(summary).toContain('Last success:');
      expect(summary).toMatch(/\d+s ago/);
    });

    it('includes server capacity info when available', () => {
      const state: BackpressureState = {
        ...initialState,
        lastCapacity: {
          ready: true,
          maxBatchSize: 100,
          delayBetweenBatches: 1000,
          retryAfter: 0,
          loadPercent: 45,
        },
      };

      const summary = getStatusSummary(state);

      expect(summary).toContain('Server load: 45%');
      expect(summary).toContain('Max batch: 100');
    });

    it('handles unknown server load', () => {
      const state: BackpressureState = {
        ...initialState,
        lastCapacity: {
          ready: true,
          maxBatchSize: 50,
          delayBetweenBatches: 500,
          retryAfter: 0,
        },
      };

      const summary = getStatusSummary(state);

      expect(summary).toContain('Server load: unknown%');
      expect(summary).toContain('Max batch: 50');
    });

    it('combines multiple status indicators', () => {
      const state: BackpressureState = {
        ...initialState,
        consecutiveFailures: 2,
        backoffLevel: 1,
        pendingEventCount: 25,
        lastSuccessTime: Date.now() - 10000,
        lastCapacity: {
          ready: true,
          maxBatchSize: 50,
          delayBetweenBatches: 1000,
          retryAfter: 0,
          loadPercent: 30,
        },
      };

      const summary = getStatusSummary(state);

      expect(summary).toContain('Consecutive failures: 2');
      expect(summary).toContain('Backoff level: 1/10');
      expect(summary).toContain('Pending events: 25');
      expect(summary).toContain('Last success:');
      expect(summary).toContain('Server load: 30%');
    });
  });
});
