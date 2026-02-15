/**
 * @rulecatch/ai-pooler - AI Development Analytics Pooler
 *
 * Production-grade tracking for AI-assisted development including:
 * - Token usage with prompt caching and thinking tokens
 * - Active time tracking (coding vs idle)
 * - Per-file and per-language cost breakdown
 * - Conversation turns and user interventions
 * - Response latency metrics
 */

export * from './types.js';
export * from './crypto.js';
export {
  collectGitContext,
  watchGitChanges,
  getGitSummary,
  isGitRepo,
  getGitRoot,
} from './git.js';

import type {
  AIDevEvent,
  MCPConfig,
  SessionMetrics,
  AIModel,
  RuleViolationCategory,
  RuleViolationSeverity,
  GitContext,
} from './types.js';
import { calculateCost, formatDuration, formatCost } from './types.js';
import { collectGitContext, watchGitChanges, getGitSummary } from './git.js';

/**
 * Event buffer for batching
 */
const eventBuffer: AIDevEvent[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Current git context
 */
let gitContext: GitContext = {};
let stopGitWatcher: (() => void) | null = null;

/**
 * Current session state with enhanced tracking
 */
let currentSession: {
  id: string;
  startTime: string;
  events: AIDevEvent[];
  turnNumber: number;
  lastActivityTime: number;
  activeTimeMs: number;
  fileCosts: Map<string, number>;
  languageCosts: Map<string, number>;
  fileChanges: Map<string, number>;
  toolCalls: Map<string, { success: number; fail: number }>;
  responseTimes: number[];
  timeToFirstTokens: number[];
  contextUsages: number[];
  ruleViolations: Map<string, { count: number; severity: RuleViolationSeverity }>;
  violationsByCategory: Map<RuleViolationCategory, number>;
  violationsBySeverity: Map<RuleViolationSeverity, number>;
  violationsBySource: Map<string, number>;
  correctionsCount: number;
} | null = null;

/**
 * Configuration
 */
let config: MCPConfig | null = null;

/**
 * Initialize the Rulecatch AI MCP server
 */
export function init(options: MCPConfig): void {
  config = {
    endpoint: options.region === 'eu'
      ? 'https://api-eu.rulecatch.ai/api/v1/ai/ingest'
      : 'https://api.rulecatch.ai/api/v1/ai/ingest',
    batchSize: 10,
    flushInterval: 30000,
    includeFilePaths: true,
    trackActiveTime: true,
    trackGitContext: true,
    idleTimeout: 5 * 60 * 1000, // 5 minutes
    debug: false,
    ...options,
  };

  // Collect initial git context
  if (config.trackGitContext !== false) {
    gitContext = collectGitContext(config.cwd);

    if (config.debug) {
      console.log('[rulecatch-ai] Git context:', getGitSummary(gitContext));
    }

    // Watch for git changes (branch switches, commits)
    stopGitWatcher = watchGitChanges(
      (newContext) => {
        gitContext = newContext;
        if (config?.debug) {
          console.log('[rulecatch-ai] Git context updated:', getGitSummary(newContext));
        }
      },
      { cwd: config.cwd, pollInterval: 10000 }
    );
  }

  if (config.debug) {
    console.log('[rulecatch-ai] Initialized with config:', {
      projectId: config.projectId,
      endpoint: config.endpoint,
      git: getGitSummary(gitContext),
    });
  }

  // Start session automatically
  startSession();
}

/**
 * Start a new development session
 */
export function startSession(): string {
  const sessionId = generateSessionId();
  const now = new Date().toISOString();

  currentSession = {
    id: sessionId,
    startTime: now,
    events: [],
    turnNumber: 0,
    lastActivityTime: Date.now(),
    activeTimeMs: 0,
    fileCosts: new Map(),
    languageCosts: new Map(),
    fileChanges: new Map(),
    toolCalls: new Map(),
    responseTimes: [],
    timeToFirstTokens: [],
    contextUsages: [],
    ruleViolations: new Map(),
    violationsByCategory: new Map(),
    violationsBySeverity: new Map(),
    violationsBySource: new Map(),
    correctionsCount: 0,
  };

  track({
    type: 'session_start',
    timestamp: now,
    sessionId,
    projectId: config?.projectId || 'unknown',
  });

  return sessionId;
}

/**
 * End the current session
 */
export function endSession(): SessionMetrics | null {
  if (!currentSession) return null;

  const now = new Date().toISOString();

  // Update active time for final segment
  updateActiveTime();

  track({
    type: 'session_end',
    timestamp: now,
    sessionId: currentSession.id,
    projectId: config?.projectId || 'unknown',
  });

  const metrics = calculateSessionMetrics(currentSession.events);
  flush(); // Ensure all events are sent

  // Stop git watcher
  if (stopGitWatcher) {
    stopGitWatcher();
    stopGitWatcher = null;
  }

  currentSession = null;
  return metrics;
}

/**
 * Update active time tracking
 */
function updateActiveTime(): void {
  if (!currentSession || !config?.trackActiveTime) return;

  const now = Date.now();
  const idleTimeout = config.idleTimeout || 5 * 60 * 1000;
  const timeSinceLastActivity = now - currentSession.lastActivityTime;

  if (timeSinceLastActivity < idleTimeout) {
    currentSession.activeTimeMs += timeSinceLastActivity;
  }

  currentSession.lastActivityTime = now;
}

/**
 * Track an AI request/response with full metrics
 */
export function trackAIRequest(params: {
  model: AIModel | string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  thinkingTokens?: number;
  promptLength?: number;
  responseLength?: number;
  contextUsage?: number;
  timeToFirstToken?: number;
  totalResponseTime?: number;
  filesContext?: string[];
  language?: string;
  taskContext?: string;
  metadata?: Record<string, unknown>;
}): void {
  updateActiveTime();

  const cost = calculateCost(params.model, params.inputTokens, params.outputTokens, {
    cacheReadTokens: params.cacheReadTokens,
    cacheWriteTokens: params.cacheWriteTokens,
    thinkingTokens: params.thinkingTokens,
  });

  // Track per-file costs
  if (currentSession && params.filesContext) {
    const costPerFile = cost / params.filesContext.length;
    for (const file of params.filesContext) {
      const current = currentSession.fileCosts.get(file) || 0;
      currentSession.fileCosts.set(file, current + costPerFile);
    }
  }

  // Track per-language costs
  if (currentSession && params.language) {
    const current = currentSession.languageCosts.get(params.language) || 0;
    currentSession.languageCosts.set(params.language, current + cost);
  }

  // Track response times
  if (currentSession) {
    if (params.totalResponseTime) {
      currentSession.responseTimes.push(params.totalResponseTime);
    }
    if (params.timeToFirstToken) {
      currentSession.timeToFirstTokens.push(params.timeToFirstToken);
    }
    if (params.contextUsage !== undefined) {
      currentSession.contextUsages.push(params.contextUsage);
    }
  }

  track({
    type: 'ai_request',
    timestamp: new Date().toISOString(),
    sessionId: currentSession?.id || 'unknown',
    projectId: config?.projectId || 'unknown',
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    cacheReadTokens: params.cacheReadTokens,
    cacheWriteTokens: params.cacheWriteTokens,
    thinkingTokens: params.thinkingTokens,
    promptLength: params.promptLength,
    responseLength: params.responseLength,
    contextUsage: params.contextUsage,
    timeToFirstToken: params.timeToFirstToken,
    totalResponseTime: params.totalResponseTime,
    estimatedCost: cost,
    promptCached: (params.cacheReadTokens || 0) > 0,
    filesModified: params.filesContext,
    language: params.language,
    taskContext: params.taskContext,
    metadata: params.metadata,
  });
}

/**
 * Track a conversation turn (user message + AI response cycle)
 */
export function trackConversationTurn(params: {
  userIntervention?: boolean;
  taskContext?: string;
  metadata?: Record<string, unknown>;
}): void {
  updateActiveTime();

  if (currentSession) {
    currentSession.turnNumber++;
  }

  track({
    type: 'conversation_turn',
    timestamp: new Date().toISOString(),
    sessionId: currentSession?.id || 'unknown',
    projectId: config?.projectId || 'unknown',
    turnNumber: currentSession?.turnNumber || 1,
    userIntervention: params.userIntervention,
    taskContext: params.taskContext,
    metadata: params.metadata,
  });
}

/**
 * Track a tool call with enhanced metrics
 */
export function trackToolCall(params: {
  toolName: string;
  success: boolean;
  duration: number;
  inputSize?: number;
  outputSize?: number;
  linesAdded?: number;
  linesRemoved?: number;
  filesModified?: string[];
  language?: string;
  fileOperation?: 'read' | 'write' | 'edit' | 'delete' | 'create';
  retryAttempt?: number;
  metadata?: Record<string, unknown>;
}): void {
  updateActiveTime();

  // Track tool success/failure by name
  if (currentSession) {
    const stats = currentSession.toolCalls.get(params.toolName) || { success: 0, fail: 0 };
    if (params.success) {
      stats.success++;
    } else {
      stats.fail++;
    }
    currentSession.toolCalls.set(params.toolName, stats);

    // Track file changes
    if (params.filesModified) {
      for (const file of params.filesModified) {
        const changes = (params.linesAdded || 0) + (params.linesRemoved || 0);
        const current = currentSession.fileChanges.get(file) || 0;
        currentSession.fileChanges.set(file, current + changes);
      }
    }
  }

  track({
    type: 'tool_call',
    timestamp: new Date().toISOString(),
    sessionId: currentSession?.id || 'unknown',
    projectId: config?.projectId || 'unknown',
    toolName: params.toolName,
    toolSuccess: params.success,
    toolDuration: params.duration,
    toolInputSize: params.inputSize,
    toolOutputSize: params.outputSize,
    linesAdded: params.linesAdded,
    linesRemoved: params.linesRemoved,
    filesModified: config?.includeFilePaths ? params.filesModified : undefined,
    language: params.language,
    fileOperation: params.fileOperation,
    retryAttempt: params.retryAttempt,
    metadata: params.metadata,
  });
}

/**
 * Track file operation (read/write/edit)
 */
export function trackFileOperation(params: {
  operation: 'read' | 'write' | 'edit' | 'delete' | 'create';
  file: string;
  linesAdded?: number;
  linesRemoved?: number;
  language?: string;
  duration?: number;
}): void {
  updateActiveTime();

  if (currentSession) {
    const changes = (params.linesAdded || 0) + (params.linesRemoved || 0);
    const current = currentSession.fileChanges.get(params.file) || 0;
    currentSession.fileChanges.set(params.file, current + changes);
  }

  track({
    type: 'file_operation',
    timestamp: new Date().toISOString(),
    sessionId: currentSession?.id || 'unknown',
    projectId: config?.projectId || 'unknown',
    fileOperation: params.operation,
    filesModified: [params.file],
    linesAdded: params.linesAdded,
    linesRemoved: params.linesRemoved,
    language: params.language,
    toolDuration: params.duration,
  });
}

/**
 * Track code acceptance/rejection with context
 */
export function trackCodeDecision(params: {
  accepted: boolean;
  linesAdded?: number;
  linesRemoved?: number;
  filesModified?: string[];
  language?: string;
  userIntervention?: boolean;
  taskContext?: string;
}): void {
  updateActiveTime();

  track({
    type: params.accepted ? 'code_accept' : 'code_reject',
    timestamp: new Date().toISOString(),
    sessionId: currentSession?.id || 'unknown',
    projectId: config?.projectId || 'unknown',
    linesAdded: params.linesAdded,
    linesRemoved: params.linesRemoved,
    filesModified: config?.includeFilePaths ? params.filesModified : undefined,
    language: params.language,
    userIntervention: params.userIntervention,
    taskContext: params.taskContext,
  });
}

/**
 * Track an error event
 */
export function trackError(params: {
  message: string;
  recovered?: boolean;
  retryAttempt?: number;
  toolName?: string;
  metadata?: Record<string, unknown>;
}): void {
  track({
    type: 'error',
    timestamp: new Date().toISOString(),
    sessionId: currentSession?.id || 'unknown',
    projectId: config?.projectId || 'unknown',
    errorMessage: params.message,
    errorRecovered: params.recovered,
    retryAttempt: params.retryAttempt,
    toolName: params.toolName,
    metadata: params.metadata,
  });
}

/**
 * Track a rule violation (coding standard violation, pattern anti-pattern, etc.)
 *
 * Use this to track when AI-generated code violates established
 * project rules like those in CLAUDE.md, eslint configs, or architectural patterns.
 *
 * @example
 * trackRuleDeviation({
 *   ruleName: 'use-bulkwrite',
 *   ruleSource: 'CLAUDE.md',
 *   category: 'db_pattern',
 *   severity: 'warning',
 *   description: 'MongoDB writes should use bulkWrite instead of individual operations',
 *   violatingCode: 'await collection.updateOne(...)',
 *   suggestedFix: 'Use collection.bulkWrite([{ updateOne: {...} }])',
 *   file: 'src/api/ingest.ts',
 *   line: 238,
 *   corrected: true,
 *   confidence: 0.95,
 * });
 */
export function trackRuleDeviation(params: {
  /** Name/identifier of the rule that was violated */
  ruleName: string;
  /** Source of the rule (e.g., "CLAUDE.md", "eslint", "project-standards") */
  ruleSource?: string;
  /** Category of the rule violation */
  category?: RuleViolationCategory;
  /** Severity of the violation */
  severity?: RuleViolationSeverity;
  /** Description of what rule was violated */
  description?: string;
  /** The problematic code or pattern */
  violatingCode?: string;
  /** Suggested fix or correct pattern */
  suggestedFix?: string;
  /** File where the violation occurred */
  file?: string;
  /** Line number where violation occurred */
  line?: number;
  /** Whether the violation was auto-corrected */
  corrected?: boolean;
  /** Confidence score (0-1) that this is actually a violation */
  confidence?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}): void {
  const category = params.category || 'custom';
  const severity = params.severity || 'warning';
  const source = params.ruleSource || 'unknown';

  // Update session tracking
  if (currentSession) {
    // Track by rule name
    const existing = currentSession.ruleViolations.get(params.ruleName);
    if (existing) {
      existing.count++;
    } else {
      currentSession.ruleViolations.set(params.ruleName, { count: 1, severity });
    }

    // Track by category
    const categoryCount = currentSession.violationsByCategory.get(category) || 0;
    currentSession.violationsByCategory.set(category, categoryCount + 1);

    // Track by severity
    const severityCount = currentSession.violationsBySeverity.get(severity) || 0;
    currentSession.violationsBySeverity.set(severity, severityCount + 1);

    // Track by source
    const sourceCount = currentSession.violationsBySource.get(source) || 0;
    currentSession.violationsBySource.set(source, sourceCount + 1);

    // Track corrections
    if (params.corrected) {
      currentSession.correctionsCount++;
    }
  }

  track({
    type: 'rule_deviation',
    timestamp: new Date().toISOString(),
    sessionId: currentSession?.id || 'unknown',
    projectId: config?.projectId || 'unknown',
    ruleName: params.ruleName,
    ruleSource: source,
    ruleCategory: category,
    ruleSeverity: severity,
    ruleDescription: params.description,
    violatingCode: params.violatingCode,
    suggestedFix: params.suggestedFix,
    violationFile: params.file,
    violationLine: params.line,
    corrected: params.corrected,
    violationConfidence: params.confidence,
    metadata: params.metadata,
  });
}

/**
 * Track a generic event
 */
export function track(event: AIDevEvent): void {
  // Add version info from config (customer-defined via env vars)
  if (config?.version) {
    (event as Record<string, unknown>).version = config.version;
  }
  if (config?.commit) {
    (event as Record<string, unknown>).configCommit = config.commit;
  }

  // Automatically add git context to all events
  if (config?.trackGitContext !== false && gitContext) {
    event.gitUsername = gitContext.username;
    event.gitEmail = gitContext.email;
    event.gitRepo = gitContext.repoName;
    event.gitBranch = gitContext.branch;
    event.gitCommit = gitContext.commit;
    event.gitDirty = gitContext.isDirty;
  }

  if (currentSession) {
    currentSession.events.push(event);
  }

  eventBuffer.push(event);

  if (config?.debug) {
    console.log('[rulecatch-ai] Event:', event.type, event);
  }

  // Check if we should flush
  if (eventBuffer.length >= (config?.batchSize || 10)) {
    flush();
  } else if (!flushTimeout && config?.flushInterval) {
    flushTimeout = setTimeout(flush, config.flushInterval);
  }
}

/**
 * Flush events to Rulecatch API
 */
export async function flush(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  if (eventBuffer.length === 0) return;

  const events = [...eventBuffer];
  eventBuffer.length = 0;

  if (!config?.licenseKey || !config?.endpoint) {
    if (config?.debug) {
      console.log('[rulecatch-ai] No license key or endpoint configured, skipping flush');
    }
    return;
  }

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.licenseKey}`,
      },
      body: JSON.stringify({
        projectId: config.projectId,
        events,
        gitContext: config.trackGitContext !== false ? {
          username: gitContext.username,
          email: gitContext.email,
          repo: gitContext.repoName,
          branch: gitContext.branch,
          commit: gitContext.commit,
          isDirty: gitContext.isDirty,
        } : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (config.debug) {
      console.log(`[rulecatch-ai] Flushed ${events.length} events`);
    }
  } catch (error) {
    if (config?.debug) {
      console.error('[rulecatch-ai] Failed to flush events:', error);
    }
    // Re-add events to buffer for retry
    eventBuffer.unshift(...events);
  }
}

/**
 * Calculate comprehensive session metrics from events
 */
function calculateSessionMetrics(events: AIDevEvent[]): SessionMetrics {
  const sessionStart = events.find((e) => e.type === 'session_start');
  const sessionEnd = events.find((e) => e.type === 'session_end');

  const startTime = sessionStart?.timestamp || new Date().toISOString();
  const endTime = sessionEnd?.timestamp;

  const duration = endTime
    ? (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000
    : 0;

  const activeDuration = currentSession
    ? currentSession.activeTimeMs / 1000
    : duration;

  const aiRequests = events.filter((e) => e.type === 'ai_request');
  const toolCalls = events.filter((e) => e.type === 'tool_call');
  const codeAccepts = events.filter((e) => e.type === 'code_accept');
  const codeRejects = events.filter((e) => e.type === 'code_reject');
  const turns = events.filter((e) => e.type === 'conversation_turn');
  const errors = events.filter((e) => e.type === 'error');
  const interventions = events.filter((e) => e.userIntervention);

  // Token metrics
  const totalInputTokens = aiRequests.reduce((sum, e) => sum + (e.inputTokens || 0), 0);
  const totalOutputTokens = aiRequests.reduce((sum, e) => sum + (e.outputTokens || 0), 0);
  const totalThinkingTokens = aiRequests.reduce((sum, e) => sum + (e.thinkingTokens || 0), 0);
  const totalCacheReadTokens = aiRequests.reduce((sum, e) => sum + (e.cacheReadTokens || 0), 0);
  const totalCost = aiRequests.reduce((sum, e) => sum + (e.estimatedCost || 0), 0);

  // Cache hit rate
  const cachedRequests = aiRequests.filter((e) => e.promptCached);
  const cacheHitRate = aiRequests.length > 0 ? cachedRequests.length / aiRequests.length : 0;

  // Context usage
  const contextUsages = aiRequests.map((e) => e.contextUsage).filter((c) => c !== undefined) as number[];
  const avgContextUsage = contextUsages.length > 0
    ? contextUsages.reduce((a, b) => a + b, 0) / contextUsages.length
    : 0;

  // Response times
  const responseTimes = currentSession?.responseTimes || [];
  const avgResponseTime = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : 0;

  const timeToFirstTokens = currentSession?.timeToFirstTokens || [];
  const avgTimeToFirstToken = timeToFirstTokens.length > 0
    ? timeToFirstTokens.reduce((a, b) => a + b, 0) / timeToFirstTokens.length
    : 0;

  // Tool metrics
  const successfulTools = toolCalls.filter((e) => e.toolSuccess);
  const toolSuccessRate = toolCalls.length > 0 ? successfulTools.length / toolCalls.length : 1;

  const toolCallsByName: Record<string, number> = {};
  const toolFailuresByName: Record<string, number> = {};
  if (currentSession) {
    for (const [name, stats] of currentSession.toolCalls) {
      toolCallsByName[name] = stats.success + stats.fail;
      if (stats.fail > 0) {
        toolFailuresByName[name] = stats.fail;
      }
    }
  }

  // Code metrics
  const allLinesAdded = events.reduce((sum, e) => sum + (e.linesAdded || 0), 0);
  const allLinesRemoved = events.reduce((sum, e) => sum + (e.linesRemoved || 0), 0);

  const allFiles = new Set<string>();
  events.forEach((e) => e.filesModified?.forEach((f) => allFiles.add(f)));

  // Top modified files
  const topModifiedFiles: Array<{ file: string; changes: number }> = [];
  if (currentSession) {
    const sorted = [...currentSession.fileChanges.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [file, changes] of sorted) {
      topModifiedFiles.push({ file, changes });
    }
  }

  // Cost breakdowns
  const costByFile: Record<string, number> = {};
  const costByLanguage: Record<string, number> = {};
  if (currentSession) {
    for (const [file, cost] of currentSession.fileCosts) {
      costByFile[file] = Math.round(cost * 10000) / 10000;
    }
    for (const [lang, cost] of currentSession.languageCosts) {
      costByLanguage[lang] = Math.round(cost * 10000) / 10000;
    }
  }

  // Acceptance and intervention rates
  const codeDecisions = codeAccepts.length + codeRejects.length;
  const codeAcceptanceRate = codeDecisions > 0 ? codeAccepts.length / codeDecisions : 1;
  const userInterventionRate = turns.length > 0 ? interventions.length / turns.length : 0;

  // Model usage
  const modelCounts: Record<string, number> = {};
  aiRequests.forEach((e) => {
    const model = e.model || 'unknown';
    modelCounts[model] = (modelCounts[model] || 0) + 1;
  });
  const primaryModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

  const languages = [...new Set(events.map((e) => e.language).filter(Boolean))] as string[];

  // Productivity metrics
  const activeMinutes = activeDuration / 60;
  const tokensPerMinute = activeMinutes > 0 ? (totalInputTokens + totalOutputTokens) / activeMinutes : 0;
  const activeHours = activeDuration / 3600;
  const linesPerHour = activeHours > 0 ? allLinesAdded / activeHours : 0;
  const costPerLine = allLinesAdded > 0 ? totalCost / allLinesAdded : 0;

  // Error metrics
  const recoveredErrors = errors.filter((e) => e.errorRecovered);
  const errorRecoveryRate = errors.length > 0 ? recoveredErrors.length / errors.length : 1;

  // Rule violation metrics
  const ruleViolationEvents = events.filter((e) => e.type === 'rule_deviation');
  const totalRuleViolations = ruleViolationEvents.length;

  const violationsByCategory: Record<RuleViolationCategory, number> = {
    coding_standard: 0,
    db_pattern: 0,
    security: 0,
    performance: 0,
    architecture: 0,
    documentation: 0,
    testing: 0,
    custom: 0,
  };
  const violationsBySeverity: Record<RuleViolationSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
  };
  const violationsBySource: Record<string, number> = {};
  const ruleViolationCounts: Record<string, { count: number; severity: RuleViolationSeverity }> = {};
  const fileViolationCounts: Record<string, number> = {};
  let correctedCount = 0;

  // Process violation events
  ruleViolationEvents.forEach((d) => {
    if (d.ruleCategory) {
      violationsByCategory[d.ruleCategory] = (violationsByCategory[d.ruleCategory] || 0) + 1;
    }
    if (d.ruleSeverity) {
      violationsBySeverity[d.ruleSeverity] = (violationsBySeverity[d.ruleSeverity] || 0) + 1;
    }
    if (d.ruleSource) {
      violationsBySource[d.ruleSource] = (violationsBySource[d.ruleSource] || 0) + 1;
    }
    if (d.ruleName) {
      if (!ruleViolationCounts[d.ruleName]) {
        ruleViolationCounts[d.ruleName] = { count: 0, severity: d.ruleSeverity || 'warning' };
      }
      ruleViolationCounts[d.ruleName].count++;
    }
    if (d.violationFile) {
      fileViolationCounts[d.violationFile] = (fileViolationCounts[d.violationFile] || 0) + 1;
    }
    if (d.corrected) {
      correctedCount++;
    }
  });

  // Use session data if available (more accurate)
  if (currentSession) {
    for (const [category, count] of currentSession.violationsByCategory) {
      violationsByCategory[category] = count;
    }
    for (const [severity, count] of currentSession.violationsBySeverity) {
      violationsBySeverity[severity] = count;
    }
    for (const [source, count] of currentSession.violationsBySource) {
      violationsBySource[source] = count;
    }
    correctedCount = currentSession.correctionsCount;
  }

  // Top rule violations
  const topRuleViolations = Object.entries(ruleViolationCounts)
    .map(([rule, { count, severity }]) => ({ rule, count, severity }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Files with most violations
  const filesWithMostViolations = Object.entries(fileViolationCounts)
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const violationCorrectionRate = totalRuleViolations > 0
    ? correctedCount / totalRuleViolations
    : 1;

  return {
    sessionId: currentSession?.id || 'unknown',
    startTime,
    endTime,
    duration,
    activeDuration,
    totalInputTokens,
    totalOutputTokens,
    totalThinkingTokens,
    totalCacheReadTokens,
    cacheHitRate,
    avgContextUsage,
    totalCost,
    costByFile,
    costByLanguage,
    requestCount: aiRequests.length,
    conversationTurns: turns.length,
    avgResponseTime,
    avgTimeToFirstToken,
    toolCallCount: toolCalls.length,
    toolSuccessRate,
    toolCallsByName,
    toolFailuresByName,
    totalLinesAdded: allLinesAdded,
    totalLinesRemoved: allLinesRemoved,
    netLinesChanged: allLinesAdded - allLinesRemoved,
    uniqueFilesModified: allFiles.size,
    topModifiedFiles,
    codeAcceptanceRate,
    userInterventionRate,
    primaryModel,
    modelUsage: modelCounts,
    languages,
    tokensPerMinute: Math.round(tokensPerMinute),
    linesPerHour: Math.round(linesPerHour * 10) / 10,
    costPerLine: Math.round(costPerLine * 10000) / 10000,
    errorCount: errors.length,
    errorRecoveryRate,
    // Rule violation metrics
    totalRuleViolations,
    violationsByCategory,
    violationsBySeverity,
    violationsBySource,
    topRuleViolations,
    violationCorrectionRate,
    filesWithMostViolations,
  };
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `ai_${timestamp}_${random}`;
}

/**
 * Get current session metrics
 */
export function getSessionMetrics(): SessionMetrics | null {
  if (!currentSession) return null;
  updateActiveTime();
  return calculateSessionMetrics(currentSession.events);
}

/**
 * Check if a session is active
 */
export function isSessionActive(): boolean {
  return currentSession !== null;
}

/**
 * Get current session ID
 */
export function getSessionId(): string | null {
  return currentSession?.id || null;
}

/**
 * Pause session (marks idle period)
 */
export function pauseSession(): void {
  if (!currentSession) return;

  updateActiveTime();

  track({
    type: 'session_pause',
    timestamp: new Date().toISOString(),
    sessionId: currentSession.id,
    projectId: config?.projectId || 'unknown',
    activeTime: currentSession.activeTimeMs,
  });
}

/**
 * Resume session
 */
export function resumeSession(): void {
  if (!currentSession) return;

  currentSession.lastActivityTime = Date.now();

  track({
    type: 'session_resume',
    timestamp: new Date().toISOString(),
    sessionId: currentSession.id,
    projectId: config?.projectId || 'unknown',
  });
}

/**
 * Get current git context
 */
export function getGitContext(): GitContext {
  return { ...gitContext };
}

/**
 * Manually refresh git context
 */
export function refreshGitContext(): GitContext {
  gitContext = collectGitContext(config?.cwd);
  return { ...gitContext };
}
