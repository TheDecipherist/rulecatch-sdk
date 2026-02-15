/**
 * Rulecatch AI - MCP Development Analytics Types
 *
 * Event types and interfaces for tracking AI-assisted development metrics.
 */

/**
 * Types of events tracked by Rulecatch AI
 */
export type AIEventType =
  | 'ai_request'
  | 'ai_response'
  | 'tool_call'
  | 'tool_result'
  | 'code_accept'
  | 'code_reject'
  | 'code_modify'
  | 'session_start'
  | 'session_end'
  | 'session_pause'
  | 'session_resume'
  | 'conversation_turn'
  | 'file_operation'
  | 'rule_deviation'
  | 'error';

/**
 * Categories of rule violations that can be tracked
 */
export type RuleViolationCategory =
  | 'coding_standard'   // Violates project coding standards (CLAUDE.md, eslint, etc.)
  | 'db_pattern'        // Database access pattern violation (e.g., not using bulkWrite)
  | 'security'          // Security best practice violation
  | 'performance'       // Performance anti-pattern
  | 'architecture'      // Architectural rule violation
  | 'documentation'     // Documentation requirement not met
  | 'testing'           // Testing requirement not met
  | 'custom';           // Custom project-specific rule

/**
 * Severity levels for rule violations
 */
export type RuleViolationSeverity =
  | 'info'      // Informational, minor suggestion
  | 'warning'   // Should be addressed, but not critical
  | 'error';    // Must be addressed, significant violation

/**
 * Supported AI models for cost calculation
 * Updated January 2026
 */
export type AIModel =
  // Claude 4 series
  | 'claude-opus-4-5'
  | 'claude-sonnet-4'
  // Claude 3.5 series
  | 'claude-3.5-sonnet'
  | 'claude-3.5-haiku'
  // Claude 3 series
  | 'claude-3-opus'
  | 'claude-3-sonnet'
  | 'claude-3-haiku'
  // GPT series
  | 'gpt-4'
  | 'gpt-4-turbo'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'o1'
  | 'o1-mini'
  | 'o1-pro'
  // Gemini
  | 'gemini-2.0-flash'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-flash'
  | 'unknown';

/**
 * Base event interface for all AI development events
 */
export interface AIDevEvent {
  /** Event type identifier */
  type: AIEventType;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Unique session identifier */
  sessionId: string;

  /** Project identifier (from license) */
  projectId: string;

  // === Token Tracking ===

  /** Input tokens consumed */
  inputTokens?: number;

  /** Output tokens generated */
  outputTokens?: number;

  /** Cache read tokens (prompt caching) */
  cacheReadTokens?: number;

  /** Cache write tokens (prompt caching) */
  cacheWriteTokens?: number;

  /** Thinking tokens (extended thinking) */
  thinkingTokens?: number;

  // === Content Metrics ===

  /** Prompt character length */
  promptLength?: number;

  /** Response character length */
  responseLength?: number;

  /** Context window usage (0-1) */
  contextUsage?: number;

  // === Timing Metrics ===

  /** Time to first token in ms */
  timeToFirstToken?: number;

  /** Total response time in ms */
  totalResponseTime?: number;

  /** Active coding time in ms (excludes idle) */
  activeTime?: number;

  /** Request latency in ms */
  latency?: number;

  // === Model & Cost ===

  /** AI model used */
  model?: AIModel | string;

  /** Estimated cost in USD */
  estimatedCost?: number;

  /** Was prompt cached */
  promptCached?: boolean;

  // === Tool Tracking ===

  /** MCP tool name (for tool events) */
  toolName?: string;

  /** Whether the tool call succeeded */
  toolSuccess?: boolean;

  /** Tool execution duration in ms */
  toolDuration?: number;

  /** Tool input size (for Bash commands, file content, etc.) */
  toolInputSize?: number;

  /** Tool output size */
  toolOutputSize?: number;

  // === Code Metrics ===

  /** Lines of code added */
  linesAdded?: number;

  /** Lines of code removed */
  linesRemoved?: number;

  /** Files modified in this event */
  filesModified?: string[];

  /** Programming language */
  language?: string;

  /** Framework or library context */
  framework?: string;

  /** File operation type */
  fileOperation?: 'read' | 'write' | 'edit' | 'delete' | 'create';

  // === Conversation Tracking ===

  /** Conversation turn number */
  turnNumber?: number;

  /** Whether user intervened/modified */
  userIntervention?: boolean;

  /** Task/feature being worked on */
  taskContext?: string;

  // === Error Tracking ===

  /** Error message if event is an error */
  errorMessage?: string;

  /** Error was recovered from */
  errorRecovered?: boolean;

  /** Retry attempt number */
  retryAttempt?: number;

  // === Rule Violation Tracking ===

  /** Rule that was deviated from (for rule_deviation events) */
  ruleName?: string;

  /** Source of the rule (e.g., "CLAUDE.md", "eslint", "project-standards") */
  ruleSource?: string;

  /** Category of the rule violation */
  ruleCategory?: RuleViolationCategory;

  /** Severity of the violation */
  ruleSeverity?: RuleViolationSeverity;

  /** Description of what rule was violated (rule violation) */
  ruleDescription?: string;

  /** The problematic code or pattern that violated the rule */
  violatingCode?: string;

  /** Suggested fix or correct pattern */
  suggestedFix?: string;

  /** File where the violation occurred */
  violationFile?: string;

  /** Line number(s) where violation occurred */
  violationLine?: number;

  /** Whether the violation was auto-corrected */
  corrected?: boolean;

  /** Confidence score that this is actually a violation (0-1) */
  violationConfidence?: number;

  // === Git Context ===

  /** Git username */
  gitUsername?: string;

  /** Git email */
  gitEmail?: string;

  /** Repository name (e.g., "user/repo") */
  gitRepo?: string;

  /** Current branch */
  gitBranch?: string;

  /** Current commit (short hash) */
  gitCommit?: string;

  /** Whether there are uncommitted changes */
  gitDirty?: boolean;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session metrics aggregated from events
 */
export interface SessionMetrics {
  /** Session identifier */
  sessionId: string;

  /** Session start time */
  startTime: string;

  /** Session end time (if ended) */
  endTime?: string;

  /** Total elapsed duration in seconds */
  duration: number;

  /** Active coding time in seconds (excludes idle) */
  activeDuration: number;

  // === Token Metrics ===

  /** Total input tokens */
  totalInputTokens: number;

  /** Total output tokens */
  totalOutputTokens: number;

  /** Total thinking tokens */
  totalThinkingTokens: number;

  /** Total cache read tokens */
  totalCacheReadTokens: number;

  /** Cache hit rate (0-1) */
  cacheHitRate: number;

  /** Average context usage (0-1) */
  avgContextUsage: number;

  // === Cost Metrics ===

  /** Total estimated cost in USD */
  totalCost: number;

  /** Cost breakdown by file */
  costByFile: Record<string, number>;

  /** Cost breakdown by language */
  costByLanguage: Record<string, number>;

  // === Request Metrics ===

  /** Number of AI requests */
  requestCount: number;

  /** Number of conversation turns */
  conversationTurns: number;

  /** Average response time in ms */
  avgResponseTime: number;

  /** Average time to first token in ms */
  avgTimeToFirstToken: number;

  // === Tool Metrics ===

  /** Number of tool calls */
  toolCallCount: number;

  /** Tool success rate (0-1) */
  toolSuccessRate: number;

  /** Tool calls by name */
  toolCallsByName: Record<string, number>;

  /** Tool failures by name */
  toolFailuresByName: Record<string, number>;

  // === Code Metrics ===

  /** Lines of code added */
  totalLinesAdded: number;

  /** Lines of code removed */
  totalLinesRemoved: number;

  /** Net lines changed */
  netLinesChanged: number;

  /** Unique files modified */
  uniqueFilesModified: number;

  /** Files with most changes */
  topModifiedFiles: Array<{ file: string; changes: number }>;

  /** Code acceptance rate (0-1) */
  codeAcceptanceRate: number;

  /** User intervention rate (0-1) */
  userInterventionRate: number;

  // === Model Metrics ===

  /** Most used model */
  primaryModel: string;

  /** Models used with request counts */
  modelUsage: Record<string, number>;

  /** Languages used */
  languages: string[];

  // === Productivity Metrics ===

  /** Tokens per minute */
  tokensPerMinute: number;

  /** Lines per hour */
  linesPerHour: number;

  /** Cost per line of code */
  costPerLine: number;

  /** Errors encountered */
  errorCount: number;

  /** Error recovery rate */
  errorRecoveryRate: number;

  // === Rule Violation Metrics ===

  /** Total rule violations detected */
  totalRuleViolations: number;

  /** Rule violations by category */
  violationsByCategory: Record<RuleViolationCategory, number>;

  /** Rule violations by severity */
  violationsBySeverity: Record<RuleViolationSeverity, number>;

  /** Rule violations by source (CLAUDE.md, eslint, etc.) */
  violationsBySource: Record<string, number>;

  /** Most common rule violations */
  topRuleViolations: Array<{ rule: string; count: number; severity: RuleViolationSeverity }>;

  /** Percentage of violations that were auto-corrected */
  violationCorrectionRate: number;

  /** Files with most violations */
  filesWithMostViolations: Array<{ file: string; count: number }>;
}

/**
 * Git context information collected automatically
 */
export interface GitContext {
  /** Git username (from git config user.name) */
  username?: string;
  /** Git email (from git config user.email) */
  email?: string;
  /** Remote repository URL */
  repoUrl?: string;
  /** Repository name (extracted from URL) */
  repoName?: string;
  /** Current branch name */
  branch?: string;
  /** Current commit hash (short) */
  commit?: string;
  /** Full commit hash */
  commitFull?: string;
  /** Commit message (first line) */
  commitMessage?: string;
  /** Commit author */
  commitAuthor?: string;
  /** Commit timestamp */
  commitTimestamp?: string;
  /** Whether there are uncommitted changes */
  isDirty?: boolean;
  /** Number of uncommitted files */
  uncommittedFiles?: number;
  /** Root directory of the git repository */
  rootDir?: string;
}

/**
 * Configuration for the MCP server
 */
export interface MCPConfig {
  /** Rulecatch AI license key */
  licenseKey?: string;

  /** Project identifier */
  projectId: string;

  /** Rulecatch API endpoint */
  endpoint?: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Batch events before sending */
  batchSize?: number;

  /** Flush interval in ms */
  flushInterval?: number;

  /** Include file paths in events */
  includeFilePaths?: boolean;

  /** Languages to track (empty = all) */
  trackLanguages?: string[];

  /** Track active time (requires more events) */
  trackActiveTime?: boolean;

  /** Idle timeout in ms (default: 5 minutes) */
  idleTimeout?: number;

  /** Automatically collect and send git context */
  trackGitContext?: boolean;

  /** Working directory for git context collection */
  cwd?: string;

  /** Project version (semver) for version correlation */
  version?: string;

  /** Git commit hash for version correlation */
  commit?: string;

  /** Region for API endpoint selection */
  region?: 'us' | 'eu';
}

/**
 * Model pricing per 1M tokens
 * Updated January 2026
 */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
  thinkingPer1M?: number;
}

/**
 * Pricing table for cost calculation
 * Source: Official pricing pages as of January 2026
 */
export const MODEL_PRICING: Record<AIModel, ModelPricing> = {
  // Claude 4 series (January 2026 pricing)
  'claude-opus-4-5': {
    inputPer1M: 15.0,
    outputPer1M: 75.0,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
    thinkingPer1M: 75.0,
  },
  'claude-sonnet-4': {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
    thinkingPer1M: 15.0,
  },
  // Claude 3.5 series
  'claude-3.5-sonnet': {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  'claude-3.5-haiku': {
    inputPer1M: 0.8,
    outputPer1M: 4.0,
    cacheReadPer1M: 0.08,
    cacheWritePer1M: 1.0,
  },
  // Claude 3 series
  'claude-3-opus': {
    inputPer1M: 15.0,
    outputPer1M: 75.0,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
  'claude-3-sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
  // GPT series
  'gpt-4': { inputPer1M: 30.0, outputPer1M: 60.0 },
  'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  o1: { inputPer1M: 15.0, outputPer1M: 60.0 },
  'o1-mini': { inputPer1M: 3.0, outputPer1M: 12.0 },
  'o1-pro': { inputPer1M: 150.0, outputPer1M: 600.0 },
  // Gemini
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.0 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
  // Fallback
  unknown: { inputPer1M: 5.0, outputPer1M: 15.0 },
};

/**
 * Calculate cost from token usage with caching support
 */
export function calculateCost(
  model: AIModel | string,
  inputTokens: number,
  outputTokens: number,
  options?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    thinkingTokens?: number;
  }
): number {
  const pricing = MODEL_PRICING[model as AIModel] || MODEL_PRICING.unknown;

  // Base input/output costs
  let inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;

  let totalCost = inputCost + outputCost;

  // Cache costs (reduces input cost)
  if (options?.cacheReadTokens && pricing.cacheReadPer1M) {
    const cacheReadCost =
      (options.cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M;
    // Cache reads replace regular input cost for those tokens
    inputCost -= (options.cacheReadTokens / 1_000_000) * pricing.inputPer1M;
    totalCost = inputCost + outputCost + cacheReadCost;
  }

  if (options?.cacheWriteTokens && pricing.cacheWritePer1M) {
    const cacheWriteCost =
      (options.cacheWriteTokens / 1_000_000) * pricing.cacheWritePer1M;
    totalCost += cacheWriteCost;
  }

  // Thinking tokens (additional cost)
  if (options?.thinkingTokens && pricing.thinkingPer1M) {
    const thinkingCost =
      (options.thinkingTokens / 1_000_000) * pricing.thinkingPer1M;
    totalCost += thinkingCost;
  }

  return Math.round(totalCost * 10000) / 10000; // 4 decimal places
}

/**
 * Estimate tokens from character count
 * Rough approximation: ~4 chars per token for English
 */
export function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Format cost in USD
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}
