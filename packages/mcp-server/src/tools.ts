/**
 * Rulecatch MCP tool definitions and handlers.
 *
 * 6 tools that map 1:1 to MCP API endpoints:
 * - rulecatch_summary
 * - rulecatch_violations
 * - rulecatch_violation_detail
 * - rulecatch_rules
 * - rulecatch_fix_plan
 * - rulecatch_top_rules
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiClient } from './api-client.js';
import type {
  SummaryResponse,
  ViolationsResponse,
  ViolationDetailResponse,
  RulesResponse,
  FixPlanResponse,
  TopRulesResponse,
} from './types.js';

export function registerTools(server: McpServer, client: ApiClient): void {
  // ── Summary ───────────────────────────────────────────────────────────────

  server.registerTool(
    'rulecatch_summary',
    {
      description:
        'Get a summary of Rulecatch violations and AI coding activity for a time period. Includes top violated rules and category breakdown.',
      inputSchema: {
        period: z
          .string()
          .optional()
          .describe(
            'Time period: today, 3d, 7d, 14d, 30d, this_week, this_month, all. Default: 7d'
          ),
      },
    },
    async ({ period }) => {
      try {
        const data = await client.request<SummaryResponse>('/summary', {
          period: period || '7d',
        });

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

        const text = lines.join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Violations list ───────────────────────────────────────────────────────

  server.registerTool(
    'rulecatch_violations',
    {
      description:
        'List Rulecatch rule violations. Filter by severity, category, session, corrected status, rule name, file path, language, tool, or branch.',
      inputSchema: {
        period: z.string().optional().describe('Time period (default: 7d)'),
        severity: z
          .string()
          .optional()
          .describe('Filter by severity: error, warning, info'),
        category: z
          .string()
          .optional()
          .describe('Filter by rule category: Security, Database Patterns, Coding Standards, Architecture, etc.'),
        sessionId: z
          .string()
          .optional()
          .describe('Filter by AI session ID to see violations from a specific coding session'),
        corrected: z
          .string()
          .optional()
          .describe('Filter by corrected status: true or false'),
        rule: z.string().optional().describe('Filter by rule name'),
        file: z.string().optional().describe('Filter by file path'),
        language: z.string().optional().describe('Filter by programming language'),
        toolName: z.string().optional().describe('Filter by tool name (e.g. Write, Edit)'),
        branch: z.string().optional().describe('Filter by git branch name'),
        limit: z
          .string()
          .optional()
          .describe('Max results (default: 20, max: 50)'),
      },
    },
    async ({ period, severity, category, sessionId, corrected, rule, file, language, toolName, branch, limit }) => {
      try {
        const params: Record<string, string> = {};
        if (period) params.period = period;
        if (severity) params.severity = severity;
        if (category) params.category = category;
        if (sessionId) params.sessionId = sessionId;
        if (corrected) params.corrected = corrected;
        if (rule) params.rule = rule;
        if (file) params.file = file;
        if (language) params.language = language;
        if (toolName) params.toolName = toolName;
        if (branch) params.branch = branch;
        if (limit) params.limit = limit;

        const data = await client.request<ViolationsResponse>(
          '/violations',
          params
        );

        if (data.violations.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No violations found for the given filters.',
              },
            ],
          };
        }

        const lines = data.violations.map((v) => {
          const status = v.corrected ? 'FIXED' : v.severity.toUpperCase();
          return `[${status}] ${v.ruleName} — ${v.file}:${v.line} (${v.id})`;
        });

        const text = [
          `${data.total} violations found (showing ${data.violations.length}):`,
          '',
          ...lines,
        ].join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Violation detail ──────────────────────────────────────────────────────

  server.registerTool(
    'rulecatch_violation_detail',
    {
      description:
        'Get full details for a specific violation: file path, line number, rule description, matched conditions, git context. Use this before fixing a violation.',
      inputSchema: {
        id: z.string().describe('Violation ID (from rulecatch_violations or rulecatch_fix_plan)'),
      },
    },
    async ({ id }) => {
      try {
        const v = await client.request<ViolationDetailResponse>(
          `/violations/${id}`
        );

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

        const text = lines.filter(Boolean).join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Rules list ────────────────────────────────────────────────────────────

  server.registerTool(
    'rulecatch_rules',
    {
      description:
        'List all active Rulecatch rules with their conditions, severity, and descriptions.',
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.request<RulesResponse>('/rules');

        if (data.rules.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No rules configured. Add rules in the Rulecatch dashboard.',
              },
            ],
          };
        }

        const lines = data.rules.map((r) => {
          const status = r.enabled ? r.severity.toUpperCase() : 'DISABLED';
          let line = `[${status}] ${r.name}`;
          if (r.description) line += ` — ${r.description}`;
          if (r.conditions && r.conditions.length > 0) {
            const condStr = r.conditions
              .map((c) => `${c.field} ${c.operator} "${c.value}"`)
              .join(', ');
            line += `\n    Conditions: ${condStr}`;
          }
          return line;
        });

        const text = [`${data.rules.length} rules:`, '', ...lines].join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Fix plan ──────────────────────────────────────────────────────────────

  server.registerTool(
    'rulecatch_fix_plan',
    {
      description:
        'Get a file-by-file plan of uncorrected violations to fix. Groups by file with line numbers, rule descriptions, and conditions. Filter by session to fix violations from a specific coding session.',
      inputSchema: {
        period: z.string().optional().describe('Time period (default: 7d)'),
        severity: z
          .string()
          .optional()
          .describe(
            'Filter severity: error, warning, info. Default: error + warning'
          ),
        sessionId: z
          .string()
          .optional()
          .describe('Filter by AI session ID to fix violations from a specific coding session'),
        category: z
          .string()
          .optional()
          .describe('Filter by rule category: Security, Database Patterns, etc.'),
      },
    },
    async ({ period, severity, sessionId, category }) => {
      try {
        const params: Record<string, string> = {};
        if (period) params.period = period;
        if (severity) params.severity = severity;
        if (sessionId) params.sessionId = sessionId;
        if (category) params.category = category;

        const data = await client.request<FixPlanResponse>(
          '/fix-plan',
          params
        );

        if (data.files.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No uncorrected violations found. Everything looks clean!',
              },
            ],
          };
        }

        const lines = [
          `Fix Plan: ${data.totalUncorrected} uncorrected violations across ${data.files.length} files`,
          `Estimated fix time: ${data.estimatedFixTime} minutes (~$${data.estimatedCost} cost)`,
          '',
        ];

        for (const f of data.files) {
          lines.push(
            `--- ${f.file} (${f.violationCount} violations, worst: ${f.worstSeverity}) ---`
          );
          for (const v of f.violations) {
            lines.push(`  Line ${v.line}: [${v.severity.toUpperCase()}] ${v.ruleName}`);
            if (v.ruleDescription) {
              lines.push(`    ${v.ruleDescription}`);
            }
            if (v.fixGuide) {
              lines.push(`    Fix: ${v.fixGuide}`);
            }
            if (v.wrongExample) {
              lines.push(`    Wrong: ${v.wrongExample}`);
            }
            if (v.correctExample) {
              lines.push(`    Correct: ${v.correctExample}`);
            }
            if (v.matchedConditions && v.matchedConditions.length > 0) {
              for (const c of v.matchedConditions) {
                lines.push(`    → ${c.field} ${c.operator} "${c.value}"`);
              }
            }
          }
          lines.push('');
        }

        const text = lines.join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Top Rules ─────────────────────────────────────────────────────────────

  server.registerTool(
    'rulecatch_top_rules',
    {
      description:
        'Get the most frequently violated rules, ranked by count. Shows which rules are broken most often, with correction rates and category breakdown.',
      inputSchema: {
        period: z.string().optional().describe('Time period (default: 7d)'),
        severity: z
          .string()
          .optional()
          .describe('Filter by severity: error, warning, info'),
        category: z
          .string()
          .optional()
          .describe('Filter by rule category: Security, Database Patterns, etc.'),
        limit: z
          .string()
          .optional()
          .describe('Max rules to return (default: 10, max: 25)'),
      },
    },
    async ({ period, severity, category, limit }) => {
      try {
        const params: Record<string, string> = {};
        if (period) params.period = period;
        if (severity) params.severity = severity;
        if (category) params.category = category;
        if (limit) params.limit = limit;

        const data = await client.request<TopRulesResponse>(
          '/top-rules',
          params
        );

        if (data.rules.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No violations found for the given filters.',
              },
            ],
          };
        }

        const lines = [
          `Top Violated Rules (${data.period}) — ${data.totalViolations} total violations:`,
          '',
        ];

        for (let i = 0; i < data.rules.length; i++) {
          const r = data.rules[i];
          lines.push(
            `${i + 1}. ${r.ruleName} — ${r.count} violations (${r.percentOfTotal}% of total)`
          );
          lines.push(
            `   [${r.severity.toUpperCase()}] ${r.category} | Corrected: ${r.correctionRate}%`
          );
          if (r.description) {
            lines.push(`   ${r.description}`);
          }
          lines.push('');
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}
