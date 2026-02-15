/**
 * Comprehensive tests for @rulecatch/ai-pooler core functionality
 * Production-grade tracking for AI development analytics
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  init,
  startSession,
  endSession,
  trackAIRequest,
  trackToolCall,
  trackCodeDecision,
  trackFileOperation,
  trackConversationTurn,
  trackError,
  trackRuleDeviation,
  track,
  flush,
  getSessionMetrics,
  isSessionActive,
  getSessionId,
  pauseSession,
  resumeSession,
  calculateCost,
  formatDuration,
  formatCost,
} from '../src/index.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AI Pooler Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });

  afterEach(() => {
    if (isSessionActive()) {
      endSession();
    }
  });

  describe('init()', () => {
    it('initializes with default config', () => {
      init({ projectId: 'test-project' });
      expect(isSessionActive()).toBe(true);
    });

    it('respects custom endpoint', () => {
      init({
        projectId: 'test-project',
        endpoint: 'http://localhost:3000/api/v1/ai/ingest',
        licenseKey: 'test-key',
      });
      expect(isSessionActive()).toBe(true);
    });

    it('auto-starts a session', () => {
      init({ projectId: 'test-project' });
      const metrics = getSessionMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics?.sessionId).toMatch(/^ai_/);
    });
  });

  describe('Session Management', () => {
    beforeEach(() => {
      init({ projectId: 'test-project' });
    });

    it('startSession() creates a new session with unique ID', () => {
      const sessionId1 = startSession();
      expect(sessionId1).toMatch(/^ai_/);

      const sessionId2 = startSession();
      expect(sessionId2).not.toBe(sessionId1);
    });

    it('getSessionId() returns current session ID', () => {
      const sessionId = startSession();
      expect(getSessionId()).toBe(sessionId);
    });

    it('endSession() returns metrics and clears session', () => {
      startSession();
      trackAIRequest({
        model: 'claude-opus-4-5',
        inputTokens: 100,
        outputTokens: 50,
      });

      const metrics = endSession();

      expect(metrics).not.toBeNull();
      expect(metrics?.requestCount).toBe(1);
      expect(metrics?.totalInputTokens).toBe(100);
      expect(metrics?.totalOutputTokens).toBe(50);
      expect(isSessionActive()).toBe(false);
    });

    it('endSession() returns null when no session active', () => {
      endSession();
      const result = endSession();
      expect(result).toBeNull();
    });

    it('getSessionMetrics() returns current metrics without ending', () => {
      startSession();
      trackToolCall({ toolName: 'Bash', success: true, duration: 100 });

      const metrics = getSessionMetrics();

      expect(metrics?.toolCallCount).toBe(1);
      expect(isSessionActive()).toBe(true);
    });

    it('pauseSession() and resumeSession() work correctly', () => {
      startSession();
      pauseSession();
      resumeSession();
      expect(isSessionActive()).toBe(true);
    });
  });

  describe('trackAIRequest()', () => {
    beforeEach(() => {
      init({ projectId: 'test-project' });
    });

    it('tracks AI request with token counts', () => {
      trackAIRequest({
        model: 'claude-opus-4-5',
        inputTokens: 500,
        outputTokens: 200,
      });

      const metrics = getSessionMetrics();
      expect(metrics?.totalInputTokens).toBe(500);
      expect(metrics?.totalOutputTokens).toBe(200);
      expect(metrics?.requestCount).toBe(1);
    });

    it('calculates cost correctly for Opus 4.5', () => {
      trackAIRequest({
        model: 'claude-opus-4-5',
        inputTokens: 1000000, // 1M input
        outputTokens: 100000, // 100K output
      });

      const metrics = getSessionMetrics();
      // $15/1M input + $75/1M * 0.1 = $15 + $7.5 = $22.5
      expect(metrics?.totalCost).toBeCloseTo(22.5, 1);
    });

    it('tracks thinking tokens', () => {
      trackAIRequest({
        model: 'claude-opus-4-5',
        inputTokens: 100,
        outputTokens: 50,
        thinkingTokens: 500,
      });

      const metrics = getSessionMetrics();
      expect(metrics?.totalThinkingTokens).toBe(500);
    });

    it('tracks cache read tokens', () => {
      trackAIRequest({
        model: 'claude-opus-4-5',
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 800,
      });

      const metrics = getSessionMetrics();
      expect(metrics?.totalCacheReadTokens).toBe(800);
      expect(metrics?.cacheHitRate).toBe(1); // 1 request, 1 cached
    });

    it('tracks response times', () => {
      trackAIRequest({
        model: 'claude-opus-4-5',
        inputTokens: 100,
        outputTokens: 50,
        timeToFirstToken: 500,
        totalResponseTime: 2000,
      });

      const metrics = getSessionMetrics();
      expect(metrics?.avgTimeToFirstToken).toBe(500);
      expect(metrics?.avgResponseTime).toBe(2000);
    });

    it('tracks files in context for cost breakdown', () => {
      trackAIRequest({
        model: 'claude-opus-4-5',
        inputTokens: 1000,
        outputTokens: 500,
        filesContext: ['src/index.ts', 'src/types.ts'],
        language: 'typescript',
      });

      const metrics = getSessionMetrics();
      expect(Object.keys(metrics?.costByFile || {}).length).toBe(2);
      expect(metrics?.costByLanguage?.typescript).toBeGreaterThan(0);
    });

    it('tracks multiple requests and accumulates', () => {
      trackAIRequest({ model: 'claude-opus-4-5', inputTokens: 100, outputTokens: 50 });
      trackAIRequest({ model: 'claude-opus-4-5', inputTokens: 200, outputTokens: 100 });
      trackAIRequest({ model: 'claude-sonnet-4', inputTokens: 150, outputTokens: 75 });

      const metrics = getSessionMetrics();
      expect(metrics?.requestCount).toBe(3);
      expect(metrics?.totalInputTokens).toBe(450);
      expect(metrics?.totalOutputTokens).toBe(225);
    });

    it('identifies primary model', () => {
      trackAIRequest({ model: 'claude-opus-4-5', inputTokens: 100, outputTokens: 50 });
      trackAIRequest({ model: 'claude-opus-4-5', inputTokens: 100, outputTokens: 50 });
      trackAIRequest({ model: 'claude-sonnet-4', inputTokens: 100, outputTokens: 50 });

      const metrics = getSessionMetrics();
      expect(metrics?.primaryModel).toBe('claude-opus-4-5');
    });
  });

  describe('trackToolCall()', () => {
    beforeEach(() => {
      init({ projectId: 'test-project' });
    });

    it('tracks successful tool call', () => {
      trackToolCall({
        toolName: 'Bash',
        success: true,
        duration: 150,
      });

      const metrics = getSessionMetrics();
      expect(metrics?.toolCallCount).toBe(1);
      expect(metrics?.toolSuccessRate).toBe(1);
    });

    it('tracks failed tool call', () => {
      trackToolCall({ toolName: 'Bash', success: true, duration: 100 });
      trackToolCall({ toolName: 'Read', success: false, duration: 50 });

      const metrics = getSessionMetrics();
      expect(metrics?.toolCallCount).toBe(2);
      expect(metrics?.toolSuccessRate).toBe(0.5);
    });

    it('tracks tool calls by name', () => {
      trackToolCall({ toolName: 'Bash', success: true, duration: 100 });
      trackToolCall({ toolName: 'Bash', success: true, duration: 100 });
      trackToolCall({ toolName: 'Read', success: true, duration: 50 });

      const metrics = getSessionMetrics();
      expect(metrics?.toolCallsByName?.Bash).toBe(2);
      expect(metrics?.toolCallsByName?.Read).toBe(1);
    });

    it('tracks tool with file operations', () => {
      trackToolCall({
        toolName: 'Edit',
        success: true,
        duration: 200,
        linesAdded: 10,
        linesRemoved: 5,
        filesModified: ['src/index.ts'],
        language: 'typescript',
        fileOperation: 'edit',
      });

      const metrics = getSessionMetrics();
      expect(metrics?.totalLinesAdded).toBe(10);
      expect(metrics?.totalLinesRemoved).toBe(5);
      expect(metrics?.uniqueFilesModified).toBe(1);
      expect(metrics?.languages).toContain('typescript');
    });
  });

  describe('trackFileOperation()', () => {
    beforeEach(() => {
      init({ projectId: 'test-project' });
    });

    it('tracks file operations', () => {
      trackFileOperation({
        operation: 'write',
        file: 'src/component.tsx',
        linesAdded: 50,
        language: 'tsx',
      });

      const metrics = getSessionMetrics();
      expect(metrics?.totalLinesAdded).toBe(50);
      expect(metrics?.uniqueFilesModified).toBe(1);
    });

    it('accumulates changes per file', () => {
      trackFileOperation({ operation: 'write', file: 'src/a.ts', linesAdded: 10 });
      trackFileOperation({ operation: 'edit', file: 'src/a.ts', linesAdded: 5 });

      const metrics = getSessionMetrics();
      expect(metrics?.topModifiedFiles?.[0]?.file).toBe('src/a.ts');
      expect(metrics?.topModifiedFiles?.[0]?.changes).toBe(15);
    });
  });

  describe('trackCodeDecision()', () => {
    beforeEach(() => {
      init({ projectId: 'test-project' });
    });

    it('tracks code acceptance', () => {
      trackCodeDecision({
        accepted: true,
        linesAdded: 20,
        linesRemoved: 5,
        filesModified: ['src/component.tsx'],
        language: 'tsx',
      });

      const metrics = getSessionMetrics();
      expect(metrics?.codeAcceptanceRate).toBe(1);
      expect(metrics?.totalLinesAdded).toBe(20);
    });

    it('tracks code rejection', () => {
      trackCodeDecision({
        accepted: false,
        linesAdded: 50,
        linesRemoved: 0,
      });

      const metrics = getSessionMetrics();
      expect(metrics?.codeAcceptanceRate).toBe(0);
    });

    it('calculates acceptance rate correctly', () => {
      trackCodeDecision({ accepted: true, linesAdded: 10 });
      trackCodeDecision({ accepted: true, linesAdded: 10 });
      trackCodeDecision({ accepted: false, linesAdded: 10 });
      trackCodeDecision({ accepted: true, linesAdded: 10 });

      const metrics = getSessionMetrics();
      expect(metrics?.codeAcceptanceRate).toBe(0.75);
    });

    it('tracks user intervention', () => {
      trackCodeDecision({ accepted: true, userIntervention: true });
      trackConversationTurn({ userIntervention: true });

      const metrics = getSessionMetrics();
      expect(metrics?.userInterventionRate).toBeGreaterThan(0);
    });
  });

  describe('trackConversationTurn()', () => {
    beforeEach(() => {
      init({ projectId: 'test-project' });
    });

    it('tracks conversation turns', () => {
      trackConversationTurn({});
      trackConversationTurn({});
      trackConversationTurn({ userIntervention: true });

      const metrics = getSessionMetrics();
      expect(metrics?.conversationTurns).toBe(3);
    });
  });

  describe('trackError()', () => {
    beforeEach(() => {
      init({ projectId: 'test-project' });
    });

    it('tracks errors', () => {
      trackError({ message: 'Test error' });

      const metrics = getSessionMetrics();
      expect(metrics?.errorCount).toBe(1);
    });

    it('tracks error recovery', () => {
      trackError({ message: 'Error 1', recovered: true });
      trackError({ message: 'Error 2', recovered: false });

      const metrics = getSessionMetrics();
      expect(metrics?.errorCount).toBe(2);
      expect(metrics?.errorRecoveryRate).toBe(0.5);
    });
  });

  describe('calculateCost()', () => {
    it('calculates basic cost correctly', () => {
      const cost = calculateCost('claude-opus-4-5', 1000000, 100000);
      // $15/1M input + $7.5/100K output = $22.5
      expect(cost).toBeCloseTo(22.5, 1);
    });

    it('handles cache read tokens', () => {
      const costWithCache = calculateCost('claude-opus-4-5', 1000000, 100000, {
        cacheReadTokens: 500000,
      });
      // Should be less than without cache
      const costWithoutCache = calculateCost('claude-opus-4-5', 1000000, 100000);
      expect(costWithCache).toBeLessThan(costWithoutCache);
    });

    it('handles thinking tokens', () => {
      const costWithThinking = calculateCost('claude-opus-4-5', 100, 50, {
        thinkingTokens: 1000,
      });
      const costWithoutThinking = calculateCost('claude-opus-4-5', 100, 50);
      expect(costWithThinking).toBeGreaterThan(costWithoutThinking);
    });

    it('uses fallback pricing for unknown models', () => {
      const cost = calculateCost('unknown-model', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('formatDuration()', () => {
    it('formats seconds', () => {
      expect(formatDuration(45)).toBe('45s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(125)).toBe('2m 5s');
    });

    it('formats hours, minutes, and seconds', () => {
      expect(formatDuration(3725)).toBe('1h 2m 5s');
    });
  });

  describe('formatCost()', () => {
    it('formats small costs with 4 decimals', () => {
      expect(formatCost(0.0012)).toBe('$0.0012');
    });

    it('formats medium costs with 3 decimals', () => {
      expect(formatCost(0.123)).toBe('$0.123');
    });

    it('formats large costs with 2 decimals', () => {
      expect(formatCost(12.345)).toBe('$12.35');
    });
  });

  describe('Active Time Tracking', () => {
    beforeEach(() => {
      init({ projectId: 'test-project', trackActiveTime: true });
    });

    it('tracks active duration', async () => {
      startSession();

      // Simulate some activity
      trackToolCall({ toolName: 'Read', success: true, duration: 100 });
      await new Promise((r) => setTimeout(r, 100));
      trackToolCall({ toolName: 'Write', success: true, duration: 100 });

      const metrics = getSessionMetrics();
      expect(metrics?.activeDuration).toBeGreaterThan(0);
    });
  });

  describe('Productivity Metrics', () => {
    beforeEach(() => {
      init({ projectId: 'test-project' });
    });

    it('calculates tokens per minute', () => {
      startSession();
      trackAIRequest({ model: 'claude-opus-4-5', inputTokens: 1000, outputTokens: 500 });

      const metrics = endSession();
      // tokensPerMinute will be based on active duration
      expect(metrics?.tokensPerMinute).toBeDefined();
    });

    it('calculates lines per hour', () => {
      startSession();
      trackCodeDecision({ accepted: true, linesAdded: 100 });

      const metrics = endSession();
      expect(metrics?.linesPerHour).toBeDefined();
    });

    it('calculates cost per line', () => {
      startSession();
      trackAIRequest({ model: 'claude-opus-4-5', inputTokens: 10000, outputTokens: 5000 });
      trackCodeDecision({ accepted: true, linesAdded: 50 });

      const metrics = endSession();
      expect(metrics?.costPerLine).toBeGreaterThan(0);
    });
  });

  describe('flush()', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      init({
        projectId: 'test-project',
        endpoint: 'http://localhost:3000/api/v1/ai/ingest',
        licenseKey: 'test-key',
        batchSize: 100,
      });
    });

    it('sends events to endpoint', async () => {
      trackAIRequest({ model: 'test', inputTokens: 100, outputTokens: 50 });

      await flush();

      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toBe('http://localhost:3000/api/v1/ai/ingest');
      expect(call[1].method).toBe('POST');
    });

    it('includes authorization header', async () => {
      trackToolCall({ toolName: 'Test', success: true, duration: 100 });

      await flush();

      const call = mockFetch.mock.calls[0];
      expect(call[1].headers.Authorization).toBe('Bearer test-key');
    });

    it('sends events in correct format', async () => {
      trackAIRequest({ model: 'claude-opus-4-5', inputTokens: 100, outputTokens: 50 });

      await flush();

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.projectId).toBe('test-project');
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events.length).toBeGreaterThan(0);
    });

    it('does not send if no license key', async () => {
      init({
        projectId: 'test-project',
        endpoint: 'http://localhost:3000/api/v1/ai/ingest',
      });

      trackToolCall({ toolName: 'Test', success: true, duration: 100 });

      await flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

describe('Rule Deviation Tracking', () => {
  beforeEach(() => {
    init({ projectId: 'test-project' });
    startSession();
  });

  afterEach(() => {
    if (isSessionActive()) {
      endSession();
    }
  });

  it('tracks a rule deviation event', () => {
    trackRuleDeviation({
      ruleName: 'use-bulkwrite',
      ruleSource: 'CLAUDE.md',
      category: 'db_pattern',
      severity: 'warning',
      description: 'MongoDB writes should use bulkWrite',
      violatingCode: 'await collection.updateOne(...)',
      suggestedFix: 'Use collection.bulkWrite([...])',
      file: 'src/api/ingest.ts',
      line: 238,
    });

    const metrics = getSessionMetrics();
    expect(metrics?.totalRuleDeviations).toBe(1);
    expect(metrics?.deviationsByCategory.db_pattern).toBe(1);
    expect(metrics?.deviationsBySeverity.warning).toBe(1);
    expect(metrics?.deviationsBySource['CLAUDE.md']).toBe(1);
  });

  it('tracks multiple deviations by category', () => {
    trackRuleDeviation({
      ruleName: 'use-bulkwrite',
      category: 'db_pattern',
      severity: 'warning',
    });
    trackRuleDeviation({
      ruleName: 'no-any',
      category: 'coding_standard',
      severity: 'error',
    });
    trackRuleDeviation({
      ruleName: 'use-aggregation',
      category: 'db_pattern',
      severity: 'warning',
    });

    const metrics = getSessionMetrics();
    expect(metrics?.totalRuleDeviations).toBe(3);
    expect(metrics?.deviationsByCategory.db_pattern).toBe(2);
    expect(metrics?.deviationsByCategory.coding_standard).toBe(1);
    expect(metrics?.deviationsBySeverity.warning).toBe(2);
    expect(metrics?.deviationsBySeverity.error).toBe(1);
  });

  it('tracks correction rate', () => {
    trackRuleDeviation({
      ruleName: 'rule-1',
      category: 'coding_standard',
      corrected: true,
    });
    trackRuleDeviation({
      ruleName: 'rule-2',
      category: 'coding_standard',
      corrected: false,
    });
    trackRuleDeviation({
      ruleName: 'rule-3',
      category: 'coding_standard',
      corrected: true,
    });

    const metrics = getSessionMetrics();
    expect(metrics?.totalRuleDeviations).toBe(3);
    expect(metrics?.deviationCorrectionRate).toBeCloseTo(0.67, 1);
  });

  it('tracks top rule violations', () => {
    // Same rule violated multiple times
    for (let i = 0; i < 5; i++) {
      trackRuleDeviation({ ruleName: 'use-bulkwrite', severity: 'warning' });
    }
    for (let i = 0; i < 3; i++) {
      trackRuleDeviation({ ruleName: 'no-any', severity: 'error' });
    }
    trackRuleDeviation({ ruleName: 'use-aggregation', severity: 'info' });

    const metrics = getSessionMetrics();
    expect(metrics?.topRuleViolations[0].rule).toBe('use-bulkwrite');
    expect(metrics?.topRuleViolations[0].count).toBe(5);
    expect(metrics?.topRuleViolations[1].rule).toBe('no-any');
    expect(metrics?.topRuleViolations[1].count).toBe(3);
  });

  it('tracks files with most deviations', () => {
    trackRuleDeviation({ ruleName: 'rule-1', file: 'src/api.ts' });
    trackRuleDeviation({ ruleName: 'rule-2', file: 'src/api.ts' });
    trackRuleDeviation({ ruleName: 'rule-3', file: 'src/api.ts' });
    trackRuleDeviation({ ruleName: 'rule-4', file: 'src/utils.ts' });

    const metrics = getSessionMetrics();
    expect(metrics?.filesWithMostDeviations[0].file).toBe('src/api.ts');
    expect(metrics?.filesWithMostDeviations[0].count).toBe(3);
  });

  it('defaults to warning severity and custom category', () => {
    trackRuleDeviation({ ruleName: 'some-rule' });

    const metrics = getSessionMetrics();
    expect(metrics?.deviationsBySeverity.warning).toBe(1);
    expect(metrics?.deviationsByCategory.custom).toBe(1);
  });

  it('tracks confidence scores in metadata', () => {
    trackRuleDeviation({
      ruleName: 'pattern-match',
      confidence: 0.95,
      metadata: { pattern: 'for.*updateOne' },
    });

    const metrics = getSessionMetrics();
    expect(metrics?.totalRuleDeviations).toBe(1);
  });
});

describe('AI Pooler Integration', () => {
  let capturedPayloads: any[] = [];

  beforeEach(() => {
    capturedPayloads = [];
    mockFetch.mockImplementation(async (url, options) => {
      capturedPayloads.push({
        url,
        body: JSON.parse(options.body),
      });
      return { ok: true, json: () => Promise.resolve({ success: true }) };
    });

    init({
      projectId: 'integration-test',
      endpoint: 'http://localhost:3000/api/v1/ai/ingest',
      licenseKey: 'test-key',
      batchSize: 100,
    });
  });

  afterEach(() => {
    if (isSessionActive()) {
      endSession();
    }
  });

  it('simulates a complete development session', async () => {
    const sessionId = startSession();
    expect(sessionId).toMatch(/^ai_/);

    // AI generates code
    trackAIRequest({
      model: 'claude-opus-4-5',
      inputTokens: 5000,
      outputTokens: 2000,
      thinkingTokens: 1000,
      timeToFirstToken: 800,
      totalResponseTime: 5000,
      filesContext: ['src/component.tsx'],
      language: 'tsx',
      taskContext: 'Building new feature',
    });

    // Tool call to write file
    trackToolCall({
      toolName: 'Write',
      success: true,
      duration: 150,
      linesAdded: 50,
      filesModified: ['src/component.tsx'],
      language: 'tsx',
      fileOperation: 'write',
    });

    // User accepts the code
    trackCodeDecision({
      accepted: true,
      linesAdded: 50,
      filesModified: ['src/component.tsx'],
      language: 'tsx',
    });

    // Track conversation turn
    trackConversationTurn({ taskContext: 'Building new feature' });

    // Another AI request
    trackAIRequest({
      model: 'claude-opus-4-5',
      inputTokens: 3000,
      outputTokens: 1500,
      cacheReadTokens: 2000,
    });

    // Tool call fails
    trackToolCall({
      toolName: 'Bash',
      success: false,
      duration: 5000,
    });

    // Track error
    trackError({ message: 'Command failed', toolName: 'Bash' });

    // AI fixes it
    trackAIRequest({
      model: 'claude-opus-4-5',
      inputTokens: 4000,
      outputTokens: 1000,
    });

    // Success this time
    trackToolCall({
      toolName: 'Bash',
      success: true,
      duration: 200,
    });

    // Error recovered
    trackError({ message: 'Command failed', recovered: true });

    // End session
    const metrics = endSession();

    expect(metrics).not.toBeNull();
    expect(metrics?.requestCount).toBe(3);
    expect(metrics?.toolCallCount).toBe(3);
    expect(metrics?.toolSuccessRate).toBeCloseTo(0.67, 1);
    expect(metrics?.codeAcceptanceRate).toBe(1);
    expect(metrics?.totalInputTokens).toBe(12000);
    expect(metrics?.totalOutputTokens).toBe(4500);
    expect(metrics?.totalThinkingTokens).toBe(1000);
    expect(metrics?.totalCacheReadTokens).toBe(2000);
    expect(metrics?.uniqueFilesModified).toBe(1);
    expect(metrics?.languages).toContain('tsx');
    expect(metrics?.primaryModel).toBe('claude-opus-4-5');
    expect(metrics?.errorCount).toBe(2);
    expect(metrics?.errorRecoveryRate).toBe(0.5);
    expect(metrics?.conversationTurns).toBe(1);
    expect(metrics?.costByFile?.['src/component.tsx']).toBeGreaterThan(0);
    expect(metrics?.costByLanguage?.tsx).toBeGreaterThan(0);

    // Verify flush was called
    await flush();
    expect(capturedPayloads.length).toBeGreaterThan(0);
  });
});
