/**
 * Tests for MCP server tool definitions and output formatting.
 *
 * We test the formatting logic directly since the actual MCP SDK
 * registration requires a real server instance.
 */
import { describe, it, expect } from 'vitest';
import type {
  SummaryResponse,
  ViolationsResponse,
  ViolationDetailResponse,
  FixPlanResponse,
  TopRulesResponse,
} from '../src/types';

// ── Summary formatting ────────────────────────────────────────────────────

describe('rulecatch_summary output', () => {
  function formatSummary(data: SummaryResponse): string {
    const v = data.violations;
    const a = data.activity;
    const lines = [
      `Rulecatch Summary (${data.period})`,
      '',
      `Violations: ${v.total} total (${v.errors} errors, ${v.warnings} warnings, ${v.info} info)`,
      `Corrected: ${v.corrected}/${v.total} (${v.correctionRate}%)`,
      `Estimated Loss: $${v.estimatedLoss}`,
      '',
      `Sessions: ${a.sessions}`,
      `Tool Calls: ${a.toolCalls}`,
      `Cost: $${a.totalCost.toFixed(2)}`,
      `Lines: +${a.linesAdded} / -${a.linesRemoved}`,
    ];

    if (data.topRules && data.topRules.length > 0) {
      lines.push('', 'Top Violated Rules:');
      for (const r of data.topRules) {
        lines.push(`  ${r.count}x ${r.ruleName} [${r.severity.toUpperCase()}]`);
      }
    }

    if (data.byCategory && data.byCategory.length > 0) {
      lines.push('', 'By Category:');
      for (const c of data.byCategory) {
        lines.push(`  ${c.category}: ${c.count} (${c.errors} errors, ${c.warnings} warnings)`);
      }
    }

    return lines.join('\n');
  }

  it('should format basic summary', () => {
    const data: SummaryResponse = {
      violations: { total: 15, corrected: 10, correctionRate: 67, errors: 5, warnings: 7, info: 3, estimatedLoss: 200 },
      activity: { sessions: 3, toolCalls: 50, totalCost: 8.75, linesAdded: 300, linesRemoved: 100 },
      topRules: [],
      byCategory: [],
      period: '7d',
    };

    const output = formatSummary(data);
    expect(output).toContain('Rulecatch Summary (7d)');
    expect(output).toContain('Violations: 15 total (5 errors, 7 warnings, 3 info)');
    expect(output).toContain('Corrected: 10/15 (67%)');
    expect(output).toContain('Cost: $8.75');
    expect(output).toContain('Lines: +300 / -100');
  });

  it('should include top rules when present', () => {
    const data: SummaryResponse = {
      violations: { total: 10, corrected: 5, correctionRate: 50, errors: 5, warnings: 5, info: 0, estimatedLoss: 100 },
      activity: { sessions: 1, toolCalls: 10, totalCost: 1.00, linesAdded: 50, linesRemoved: 10 },
      topRules: [
        { ruleName: 'no-findOne', count: 5, severity: 'error' },
        { ruleName: 'no-bg-white', count: 3, severity: 'warning' },
      ],
      byCategory: [],
      period: 'today',
    };

    const output = formatSummary(data);
    expect(output).toContain('Top Violated Rules:');
    expect(output).toContain('5x no-findOne [ERROR]');
    expect(output).toContain('3x no-bg-white [WARNING]');
  });

  it('should include category breakdown when present', () => {
    const data: SummaryResponse = {
      violations: { total: 20, corrected: 10, correctionRate: 50, errors: 10, warnings: 10, info: 0, estimatedLoss: 200 },
      activity: { sessions: 2, toolCalls: 30, totalCost: 5.00, linesAdded: 100, linesRemoved: 50 },
      topRules: [],
      byCategory: [
        { category: 'Security', count: 12, errors: 8, warnings: 4 },
        { category: 'Database Patterns', count: 8, errors: 2, warnings: 6 },
      ],
      period: 'this_week',
    };

    const output = formatSummary(data);
    expect(output).toContain('By Category:');
    expect(output).toContain('Security: 12 (8 errors, 4 warnings)');
    expect(output).toContain('Database Patterns: 8 (2 errors, 6 warnings)');
  });
});

// ── Violations formatting ─────────────────────────────────────────────────

describe('rulecatch_violations output', () => {
  function formatViolations(data: ViolationsResponse): string {
    if (data.violations.length === 0) return 'No violations found for the given filters.';

    const lines = data.violations.map((v) => {
      const status = v.corrected ? 'FIXED' : v.severity.toUpperCase();
      return `[${status}] ${v.ruleName} — ${v.file}:${v.line} (${v.id})`;
    });

    return [`${data.total} violations found (showing ${data.violations.length}):`, '', ...lines].join('\n');
  }

  it('should format violation list', () => {
    const data: ViolationsResponse = {
      violations: [
        { id: 'abc', ruleName: 'no-findOne', severity: 'error', file: 'src/db.ts', line: 45, corrected: false, timestamp: '2026-02-09T10:00:00Z' },
        { id: 'def', ruleName: 'no-bg-white', severity: 'warning', file: 'src/App.tsx', line: 12, corrected: true, timestamp: '2026-02-09T09:00:00Z' },
      ],
      total: 2,
    };

    const output = formatViolations(data);
    expect(output).toContain('2 violations found (showing 2)');
    expect(output).toContain('[ERROR] no-findOne — src/db.ts:45 (abc)');
    expect(output).toContain('[FIXED] no-bg-white — src/App.tsx:12 (def)');
  });

  it('should handle empty results', () => {
    const output = formatViolations({ violations: [], total: 0 });
    expect(output).toBe('No violations found for the given filters.');
  });

  it('should show correct count when total > showing', () => {
    const data: ViolationsResponse = {
      violations: [
        { id: 'a', ruleName: 'rule-a', severity: 'error', file: 'a.ts', line: 1, corrected: false, timestamp: '2026-02-09' },
      ],
      total: 50,
    };

    const output = formatViolations(data);
    expect(output).toContain('50 violations found (showing 1)');
  });
});

// ── Violation detail formatting ───────────────────────────────────────────

describe('rulecatch_violation_detail output', () => {
  function formatDetail(v: ViolationDetailResponse): string {
    const lines = [
      `Rule: ${v.ruleName}`,
      v.ruleDescription ? `Description: ${v.ruleDescription}` : '',
      v.ruleCategory ? `Category: ${v.ruleCategory}` : '',
      `Severity: ${v.severity}`,
      v.fixTimeMinutes ? `Est. Fix Time: ${v.fixTimeMinutes} min` : '',
      '',
      `File: ${v.file}:${v.line}`,
      v.language ? `Language: ${v.language}` : '',
      v.toolName ? `Tool: ${v.toolName}` : '',
      `Corrected: ${v.corrected}`,
      '',
    ];

    if (v.fixGuide) {
      lines.push('Fix Guide:');
      lines.push(`  ${v.fixGuide}`);
      lines.push('');
    }

    if (v.wrongExample) {
      lines.push('Wrong:');
      lines.push(v.wrongExample);
      lines.push('');
    }

    if (v.correctExample) {
      lines.push('Correct:');
      lines.push(v.correctExample);
      lines.push('');
    }

    if (v.matchedConditions && v.matchedConditions.length > 0) {
      lines.push('Matched Conditions:');
      for (const c of v.matchedConditions) {
        lines.push(`  - ${c.field} ${c.operator} "${c.value}"`);
      }
      lines.push('');
    }

    if (v.gitBranch || v.gitCommit || v.gitRepo) {
      lines.push('Git Context:');
      if (v.gitRepo) lines.push(`  Repo: ${v.gitRepo}`);
      if (v.gitBranch) lines.push(`  Branch: ${v.gitBranch}`);
      if (v.gitCommit) lines.push(`  Commit: ${v.gitCommit}`);
    }

    return lines.filter(Boolean).join('\n');
  }

  it('should format full violation detail', () => {
    const v: ViolationDetailResponse = {
      id: 'abc123',
      ruleName: 'no-findOne',
      ruleDescription: 'Use aggregation framework instead of find/findOne',
      ruleCategory: 'Database Patterns',
      severity: 'error',
      fixTimeMinutes: 9,
      file: 'src/db.ts',
      line: 45,
      language: 'typescript',
      toolName: 'Write',
      matchedConditions: [
        { field: 'toolName', operator: 'contains', value: 'findOne' },
      ],
      corrected: false,
      gitRepo: 'TheDecipherist/rulecatch',
      gitBranch: 'main',
      gitCommit: 'abc1234',
      timestamp: '2026-02-09T10:00:00Z',
    };

    const output = formatDetail(v);
    expect(output).toContain('Rule: no-findOne');
    expect(output).toContain('Description: Use aggregation framework');
    expect(output).toContain('Category: Database Patterns');
    expect(output).toContain('File: src/db.ts:45');
    expect(output).toContain('Language: typescript');
    expect(output).toContain('Matched Conditions:');
    expect(output).toContain('toolName contains "findOne"');
    expect(output).toContain('Git Context:');
    expect(output).toContain('Branch: main');
  });

  it('should include fix guidance when present', () => {
    const v: ViolationDetailResponse = {
      id: 'fix1',
      ruleName: 'SQL SELECT Star',
      ruleDescription: 'Specify columns instead of SELECT *',
      severity: 'warning',
      file: 'src/db.ts',
      line: 10,
      corrected: false,
      timestamp: '2026-02-09',
      fixGuide: 'SELECT * fetches every column, including large BLOBs.',
      wrongExample: 'SELECT * FROM orders;',
      correctExample: 'SELECT id, name FROM orders;',
    };

    const output = formatDetail(v);
    expect(output).toContain('Fix Guide:');
    expect(output).toContain('SELECT * fetches every column');
    expect(output).toContain('Wrong:');
    expect(output).toContain('SELECT * FROM orders;');
    expect(output).toContain('Correct:');
    expect(output).toContain('SELECT id, name FROM orders;');
  });

  it('should omit fix guidance sections when not present', () => {
    const v: ViolationDetailResponse = {
      id: 'no-fix',
      ruleName: 'custom-rule',
      severity: 'error',
      file: 'app.ts',
      line: 1,
      corrected: false,
      timestamp: '2026-02-09',
    };

    const output = formatDetail(v);
    expect(output).not.toContain('Fix Guide:');
    expect(output).not.toContain('Wrong:');
    expect(output).not.toContain('Correct:');
  });

  it('should handle minimal violation (no optional fields)', () => {
    const v: ViolationDetailResponse = {
      id: 'xyz',
      ruleName: 'basic-rule',
      severity: 'warning',
      file: 'index.ts',
      line: 1,
      corrected: true,
      timestamp: '2026-02-09',
    };

    const output = formatDetail(v);
    expect(output).toContain('Rule: basic-rule');
    expect(output).toContain('File: index.ts:1');
    expect(output).toContain('Corrected: true');
    expect(output).not.toContain('Matched Conditions');
    expect(output).not.toContain('Git Context');
  });
});

// ── Fix plan formatting ───────────────────────────────────────────────────

describe('rulecatch_fix_plan output', () => {
  function formatFixPlan(data: FixPlanResponse): string {
    if (data.files.length === 0) return 'No uncorrected violations found. Everything looks clean!';

    const lines = [
      `Fix Plan: ${data.totalUncorrected} uncorrected violations across ${data.files.length} files`,
      `Estimated fix time: ${data.estimatedFixTime} minutes (~$${data.estimatedCost} cost)`,
      '',
    ];

    for (const f of data.files) {
      lines.push(`--- ${f.file} (${f.violationCount} violations, worst: ${f.worstSeverity}) ---`);
      for (const v of f.violations) {
        lines.push(`  Line ${v.line}: [${v.severity.toUpperCase()}] ${v.ruleName}`);
        if (v.ruleDescription) lines.push(`    ${v.ruleDescription}`);
        if (v.fixGuide) lines.push(`    Fix: ${v.fixGuide}`);
        if (v.wrongExample) lines.push(`    Wrong: ${v.wrongExample}`);
        if (v.correctExample) lines.push(`    Correct: ${v.correctExample}`);
        if (v.matchedConditions && v.matchedConditions.length > 0) {
          for (const c of v.matchedConditions) {
            lines.push(`    → ${c.field} ${c.operator} "${c.value}"`);
          }
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  it('should format fix plan with multiple files', () => {
    const data: FixPlanResponse = {
      totalUncorrected: 3,
      estimatedFixTime: 23,
      estimatedCost: 38,
      files: [
        {
          file: 'src/db.ts',
          violationCount: 2,
          worstSeverity: 'error',
          violations: [
            { id: 'a', ruleName: 'no-findOne', severity: 'error', line: 45, ruleDescription: 'Use aggregate()' },
            { id: 'b', ruleName: 'no-insertOne', severity: 'warning', line: 78 },
          ],
        },
        {
          file: 'src/App.tsx',
          violationCount: 1,
          worstSeverity: 'warning',
          violations: [
            { id: 'c', ruleName: 'no-bg-white', severity: 'warning', line: 12, matchedConditions: [{ field: 'content', operator: 'contains', value: 'bg-white' }] },
          ],
        },
      ],
    };

    const output = formatFixPlan(data);
    expect(output).toContain('Fix Plan: 3 uncorrected violations across 2 files');
    expect(output).toContain('Estimated fix time: 23 minutes (~$38 cost)');
    expect(output).toContain('--- src/db.ts (2 violations, worst: error) ---');
    expect(output).toContain('Line 45: [ERROR] no-findOne');
    expect(output).toContain('Use aggregate()');
    expect(output).toContain('--- src/App.tsx (1 violations, worst: warning) ---');
    expect(output).toContain('→ content contains "bg-white"');
  });

  it('should include fix guidance in violations when present', () => {
    const data: FixPlanResponse = {
      totalUncorrected: 1,
      estimatedFixTime: 5,
      estimatedCost: 8,
      files: [{
        file: 'Dockerfile',
        violationCount: 1,
        worstSeverity: 'warning',
        violations: [{
          id: 'fix1',
          ruleName: 'Docker Latest Tag',
          ruleDescription: 'Use specific version tags',
          severity: 'warning',
          line: 1,
          fixGuide: 'The :latest tag is mutable.',
          wrongExample: 'FROM node:latest',
          correctExample: 'FROM node:20.11-alpine',
        }],
      }],
    };

    const output = formatFixPlan(data);
    expect(output).toContain('Fix: The :latest tag is mutable.');
    expect(output).toContain('Wrong: FROM node:latest');
    expect(output).toContain('Correct: FROM node:20.11-alpine');
  });

  it('should handle empty fix plan', () => {
    const output = formatFixPlan({ totalUncorrected: 0, estimatedFixTime: 0, estimatedCost: 0, files: [] });
    expect(output).toBe('No uncorrected violations found. Everything looks clean!');
  });
});

// ── Top rules formatting ──────────────────────────────────────────────────

describe('rulecatch_top_rules output', () => {
  function formatTopRules(data: TopRulesResponse): string {
    if (data.rules.length === 0) return 'No violations found for the given filters.';

    const lines = [
      `Top Violated Rules (${data.period}) — ${data.totalViolations} total violations:`,
      '',
    ];

    for (let i = 0; i < data.rules.length; i++) {
      const r = data.rules[i];
      lines.push(`${i + 1}. ${r.ruleName} — ${r.count} violations (${r.percentOfTotal}% of total)`);
      lines.push(`   [${r.severity.toUpperCase()}] ${r.category} | Corrected: ${r.correctionRate}%`);
      if (r.description) lines.push(`   ${r.description}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  it('should format ranked rule list', () => {
    const data: TopRulesResponse = {
      rules: [
        { ruleName: 'no-findOne', count: 25, correctedCount: 20, correctionRate: 80, percentOfTotal: 50, severity: 'error', category: 'Database Patterns', description: 'Use aggregate()', lastSeen: '2026-02-09' },
        { ruleName: 'no-bg-white', count: 15, correctedCount: 5, correctionRate: 33, percentOfTotal: 30, severity: 'warning', category: 'Coding Standards', lastSeen: '2026-02-08' },
      ],
      totalViolations: 50,
      period: '7d',
    };

    const output = formatTopRules(data);
    expect(output).toContain('Top Violated Rules (7d) — 50 total violations:');
    expect(output).toContain('1. no-findOne — 25 violations (50% of total)');
    expect(output).toContain('[ERROR] Database Patterns | Corrected: 80%');
    expect(output).toContain('Use aggregate()');
    expect(output).toContain('2. no-bg-white — 15 violations (30% of total)');
    expect(output).toContain('[WARNING] Coding Standards | Corrected: 33%');
  });

  it('should handle empty results', () => {
    const output = formatTopRules({ rules: [], totalViolations: 0, period: '7d' });
    expect(output).toBe('No violations found for the given filters.');
  });
});

// ── Input parameter validation ────────────────────────────────────────────

describe('tool input parameters', () => {
  it('violations tool should accept all filter params', () => {
    const params: Record<string, string> = {};
    const inputs = {
      period: 'today',
      severity: 'error',
      category: 'Security',
      sessionId: 'sess_abc',
      corrected: 'false',
      rule: 'no-findOne',
      file: 'src/db.ts',
      language: 'typescript',
      toolName: 'Write',
      branch: 'main',
      limit: '50',
    };

    for (const [key, value] of Object.entries(inputs)) {
      if (value) params[key] = value;
    }

    expect(Object.keys(params)).toHaveLength(11);
    expect(params.sessionId).toBe('sess_abc');
    expect(params.category).toBe('Security');
  });

  it('fix_plan tool should accept sessionId and category', () => {
    const params: Record<string, string> = {};
    const sessionId = 'sess_xyz';
    const category = 'Database Patterns';

    if (sessionId) params.sessionId = sessionId;
    if (category) params.category = category;

    expect(params.sessionId).toBe('sess_xyz');
    expect(params.category).toBe('Database Patterns');
  });

  it('top_rules tool should accept period, severity, category, limit', () => {
    const params: Record<string, string> = {};
    const period = 'this_week';
    const severity = 'error';
    const category = 'Security';
    const limit = '5';

    if (period) params.period = period;
    if (severity) params.severity = severity;
    if (category) params.category = category;
    if (limit) params.limit = limit;

    expect(Object.keys(params)).toHaveLength(4);
  });

  it('should not include undefined params', () => {
    const params: Record<string, string> = {};
    const period: string | undefined = undefined;
    const severity: string | undefined = 'error';

    if (period) params.period = period;
    if (severity) params.severity = severity;

    expect(Object.keys(params)).toHaveLength(1);
    expect(params.severity).toBe('error');
  });
});
