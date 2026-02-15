/**
 * Tests for MCP server type contracts.
 * Ensures response types match what the API returns and the tools expect.
 */
import { describe, it, expect } from 'vitest';
import type {
  SummaryResponse,
  SummaryTopRule,
  SummaryCategoryBreakdown,
  ViolationListItem,
  ViolationsResponse,
  ViolationDetailResponse,
  RuleItem,
  RulesResponse,
  FixPlanFile,
  FixPlanResponse,
  TopRuleItem,
  TopRulesResponse,
} from '../src/types';

describe('SummaryResponse type contract', () => {
  it('should include topRules array', () => {
    const response: SummaryResponse = {
      violations: { total: 0, corrected: 0, correctionRate: 0, errors: 0, warnings: 0, info: 0, estimatedLoss: 0 },
      activity: { sessions: 0, toolCalls: 0, totalCost: 0, linesAdded: 0, linesRemoved: 0 },
      topRules: [],
      byCategory: [],
      period: '7d',
    };
    expect(response.topRules).toBeDefined();
    expect(Array.isArray(response.topRules)).toBe(true);
  });

  it('should include byCategory array', () => {
    const response: SummaryResponse = {
      violations: { total: 0, corrected: 0, correctionRate: 0, errors: 0, warnings: 0, info: 0, estimatedLoss: 0 },
      activity: { sessions: 0, toolCalls: 0, totalCost: 0, linesAdded: 0, linesRemoved: 0 },
      topRules: [],
      byCategory: [],
      period: '7d',
    };
    expect(response.byCategory).toBeDefined();
    expect(Array.isArray(response.byCategory)).toBe(true);
  });

  it('SummaryTopRule should have required fields', () => {
    const rule: SummaryTopRule = { ruleName: 'test', count: 5, severity: 'error' };
    expect(rule.ruleName).toBe('test');
    expect(rule.count).toBe(5);
    expect(rule.severity).toBe('error');
  });

  it('SummaryCategoryBreakdown should have required fields', () => {
    const cat: SummaryCategoryBreakdown = { category: 'Security', count: 10, errors: 6, warnings: 4 };
    expect(cat.category).toBe('Security');
    expect(cat.errors + cat.warnings).toBe(10);
  });
});

describe('TopRulesResponse type contract', () => {
  it('TopRuleItem should have all required fields', () => {
    const rule: TopRuleItem = {
      ruleName: 'no-findOne',
      count: 25,
      correctedCount: 20,
      correctionRate: 80,
      percentOfTotal: 50,
      severity: 'error',
      category: 'Database Patterns',
      lastSeen: '2026-02-09',
    };
    expect(rule.ruleName).toBe('no-findOne');
    expect(rule.correctionRate).toBe(80);
    expect(rule.percentOfTotal).toBe(50);
  });

  it('TopRuleItem description should be optional', () => {
    const rule: TopRuleItem = {
      ruleName: 'test',
      count: 1,
      correctedCount: 0,
      correctionRate: 0,
      percentOfTotal: 100,
      severity: 'warning',
      category: 'Uncategorized',
      lastSeen: '2026-02-09',
    };
    expect(rule.description).toBeUndefined();
  });

  it('TopRulesResponse should have period and totalViolations', () => {
    const response: TopRulesResponse = {
      rules: [],
      totalViolations: 0,
      period: '7d',
    };
    expect(response.period).toBe('7d');
    expect(response.totalViolations).toBe(0);
  });
});

describe('ViolationDetailResponse type contract', () => {
  it('should include sessionId and eventId as optional', () => {
    const detail: ViolationDetailResponse = {
      id: 'abc',
      ruleName: 'test',
      severity: 'error',
      file: 'test.ts',
      line: 1,
      corrected: false,
      timestamp: '2026-02-09',
      sessionId: 'sess_abc',
      eventId: 'evt_123',
    };
    expect(detail.sessionId).toBe('sess_abc');
    expect(detail.eventId).toBe('evt_123');
  });

  it('should include matchedConditions as optional array', () => {
    const detail: ViolationDetailResponse = {
      id: 'abc',
      ruleName: 'test',
      severity: 'error',
      file: 'test.ts',
      line: 1,
      corrected: false,
      timestamp: '2026-02-09',
      matchedConditions: [
        { field: 'toolName', operator: 'contains', value: 'findOne' },
      ],
    };
    expect(detail.matchedConditions).toHaveLength(1);
    expect(detail.matchedConditions![0].field).toBe('toolName');
  });

  it('should include optional fix guidance fields', () => {
    const detail: ViolationDetailResponse = {
      id: 'fix1',
      ruleName: 'SQL SELECT Star',
      severity: 'warning',
      file: 'src/db.ts',
      line: 10,
      corrected: false,
      timestamp: '2026-02-09',
      fixGuide: 'SELECT * fetches every column...',
      wrongExample: 'SELECT * FROM orders;',
      correctExample: 'SELECT id, name FROM orders;',
    };
    expect(detail.fixGuide).toBe('SELECT * fetches every column...');
    expect(detail.wrongExample).toBe('SELECT * FROM orders;');
    expect(detail.correctExample).toBe('SELECT id, name FROM orders;');
  });

  it('fix guidance fields should be optional', () => {
    const detail: ViolationDetailResponse = {
      id: 'no-fix',
      ruleName: 'custom-rule',
      severity: 'error',
      file: 'app.ts',
      line: 1,
      corrected: false,
      timestamp: '2026-02-09',
    };
    expect(detail.fixGuide).toBeUndefined();
    expect(detail.wrongExample).toBeUndefined();
    expect(detail.correctExample).toBeUndefined();
  });
});

describe('FixPlanResponse type contract', () => {
  it('should include estimatedCost', () => {
    const plan: FixPlanResponse = {
      totalUncorrected: 5,
      estimatedFixTime: 30,
      estimatedCost: 50,
      files: [],
    };
    expect(plan.estimatedCost).toBe(50);
  });

  it('FixPlanFile violations should include matchedConditions', () => {
    const file: FixPlanFile = {
      file: 'src/db.ts',
      violationCount: 1,
      worstSeverity: 'error',
      violations: [{
        id: 'abc',
        ruleName: 'no-findOne',
        severity: 'error',
        line: 45,
        matchedConditions: [
          { field: 'toolName', operator: 'contains', value: 'findOne' },
        ],
      }],
    };
    expect(file.violations[0].matchedConditions).toHaveLength(1);
  });

  it('FixPlanFile violations should include optional fix guidance', () => {
    const file: FixPlanFile = {
      file: 'src/db.ts',
      violationCount: 1,
      worstSeverity: 'warning',
      violations: [{
        id: 'fix1',
        ruleName: 'SQL SELECT Star',
        severity: 'warning',
        line: 10,
        fixGuide: 'SELECT * fetches every column...',
        wrongExample: 'SELECT * FROM orders;',
        correctExample: 'SELECT id, name FROM orders;',
      }],
    };
    expect(file.violations[0].fixGuide).toBe('SELECT * fetches every column...');
    expect(file.violations[0].wrongExample).toBe('SELECT * FROM orders;');
    expect(file.violations[0].correctExample).toBe('SELECT id, name FROM orders;');
  });

  it('FixPlanFile violations should work without fix guidance', () => {
    const file: FixPlanFile = {
      file: 'src/app.ts',
      violationCount: 1,
      worstSeverity: 'error',
      violations: [{
        id: 'no-fix',
        ruleName: 'custom-rule',
        severity: 'error',
        line: 5,
      }],
    };
    expect(file.violations[0].fixGuide).toBeUndefined();
  });
});

describe('ViolationListItem type contract', () => {
  it('should have all required fields', () => {
    const item: ViolationListItem = {
      id: 'abc',
      ruleName: 'no-findOne',
      severity: 'error',
      file: 'src/db.ts',
      line: 45,
      corrected: false,
      timestamp: '2026-02-09',
    };
    expect(item.id).toBe('abc');
    expect(item.file).toBe('src/db.ts');
  });

  it('should have optional fields', () => {
    const item: ViolationListItem = {
      id: 'abc',
      ruleName: 'test',
      severity: 'warning',
      file: 'test.ts',
      line: 1,
      corrected: true,
      timestamp: '2026-02-09',
      ruleDescription: 'A test rule',
      toolName: 'Write',
      gitBranch: 'main',
      fixTimeMinutes: 5,
    };
    expect(item.ruleDescription).toBe('A test rule');
    expect(item.toolName).toBe('Write');
    expect(item.gitBranch).toBe('main');
    expect(item.fixTimeMinutes).toBe(5);
  });
});

describe('RuleItem type contract', () => {
  it('should have all required fields', () => {
    const rule: RuleItem = {
      id: 'rule1',
      name: 'no-findOne',
      severity: 'error',
      enabled: true,
    };
    expect(rule.name).toBe('no-findOne');
    expect(rule.enabled).toBe(true);
  });

  it('should have optional conditions array', () => {
    const rule: RuleItem = {
      id: 'rule1',
      name: 'no-findOne',
      severity: 'error',
      enabled: true,
      conditions: [
        { field: 'toolName', operator: 'contains', value: 'findOne' },
      ],
    };
    expect(rule.conditions).toHaveLength(1);
  });
});
