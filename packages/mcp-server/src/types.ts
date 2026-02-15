/**
 * Response types from the MCP API service.
 */

export interface SummaryTopRule {
  ruleName: string;
  count: number;
  severity: string;
}

export interface SummaryCategoryBreakdown {
  category: string;
  count: number;
  errors: number;
  warnings: number;
}

export interface SummaryResponse {
  violations: {
    total: number;
    corrected: number;
    correctionRate: number;
    errors: number;
    warnings: number;
    info: number;
    estimatedLoss: number;
  };
  activity: {
    sessions: number;
    toolCalls: number;
    totalCost: number;
    linesAdded: number;
    linesRemoved: number;
  };
  topRules: SummaryTopRule[];
  byCategory: SummaryCategoryBreakdown[];
  period: string;
}

export interface TopRuleItem {
  ruleName: string;
  count: number;
  correctedCount: number;
  correctionRate: number;
  percentOfTotal: number;
  severity: string;
  category: string;
  description?: string;
  lastSeen: string;
}

export interface TopRulesResponse {
  rules: TopRuleItem[];
  totalViolations: number;
  period: string;
}

export interface ViolationListItem {
  id: string;
  ruleName: string;
  ruleDescription?: string;
  severity: string;
  file: string;
  line: number;
  toolName?: string;
  gitBranch?: string;
  corrected: boolean;
  fixTimeMinutes?: number;
  timestamp: string;
}

export interface ViolationsResponse {
  violations: ViolationListItem[];
  total: number;
}

export interface ViolationDetailResponse {
  id: string;
  ruleName: string;
  ruleDescription?: string;
  ruleCategory?: string;
  ruleSource?: string;
  severity: string;
  fixTimeMinutes?: number;
  file: string;
  line: number;
  language?: string;
  toolName?: string;
  matchedConditions?: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
  corrected: boolean;
  gitUsername?: string;
  gitEmail?: string;
  gitRepo?: string;
  gitBranch?: string;
  gitCommit?: string;
  fixGuide?: string;
  wrongExample?: string;
  correctExample?: string;
  timestamp: string;
  sessionId?: string;
  eventId?: string;
}

export interface RuleItem {
  id: string;
  name: string;
  description?: string;
  category?: string;
  severity: string;
  enabled: boolean;
  fixTimeMinutes?: number;
  conditions?: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
}

export interface RulesResponse {
  rules: RuleItem[];
}

export interface FixPlanFile {
  file: string;
  violationCount: number;
  worstSeverity: string;
  violations: Array<{
    id: string;
    ruleName: string;
    ruleDescription?: string;
    severity: string;
    line: number;
    fixTimeMinutes?: number;
    matchedConditions?: Array<{
      field: string;
      operator: string;
      value: string;
    }>;
    fixGuide?: string;
    wrongExample?: string;
    correctExample?: string;
  }>;
}

export interface FixPlanResponse {
  totalUncorrected: number;
  estimatedFixTime: number;
  estimatedCost: number;
  files: FixPlanFile[];
}
