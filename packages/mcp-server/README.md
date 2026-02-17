# @rulecatch/mcp-server

MCP server for Rulecatch — query your rule violations, get fix plans, and review AI coding activity directly from Claude Code.

Works with [Model Context Protocol](https://modelcontextprotocol.io) (MCP). Connects to your Rulecatch dashboard data and exposes it as tools that Claude can call during your coding sessions.

**Requires a Pro or Enterprise plan.** Not available in monitor-only mode.

## Quick Start

### 1. Install hooks first (if you haven't already)

```bash
npx @rulecatch/ai-pooler init
```

This creates `~/.claude/rulecatch/config.json` with your API key and region. The MCP server reads the same config file.

### 2. Add the MCP server to Claude Code

Add to your Claude Code MCP settings (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "rulecatch": {
      "command": "npx",
      "args": ["-y", "@rulecatch/mcp-server"]
    }
  }
}
```

That's it. Claude Code will now have access to Rulecatch tools.

## Tools

### `rulecatch_summary`

Get an overview of violations and AI coding activity for a time period.

```
"Show me my Rulecatch summary for the last 7 days"
```

Returns: total violations, correction rate, estimated loss, session count, tool calls, cost, lines changed, top violated rules, and category breakdown.

| Parameter | Default | Options |
|-----------|---------|---------|
| `period` | `7d` | `today`, `3d`, `7d`, `14d`, `30d`, `this_week`, `this_month`, `all` |

---

### `rulecatch_violations`

List rule violations with filtering.

```
"Show me all error-level violations from today"
```

| Parameter | Description |
|-----------|-------------|
| `period` | Time period (default: `7d`) |
| `severity` | `error`, `warning`, or `info` |
| `category` | Rule category (e.g., `Security`, `Database Patterns`) |
| `corrected` | `true` or `false` |
| `rule` | Filter by rule name |
| `file` | File path pattern |
| `language` | Programming language |
| `toolName` | Tool that triggered the violation (`Write`, `Edit`, `Bash`) |
| `branch` | Git branch name |
| `sessionId` | Filter by specific AI session |
| `limit` | Max results (default: 20, max: 50) |

---

### `rulecatch_violation_detail`

Get full details for a specific violation — the matched rule, file location, conditions, git context, and fix guidance with code examples.

```
"Show me details for violation abc123"
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | Violation ID from the violations list or fix plan |

Returns: rule name, description, severity, category, file path, line number, language, matched conditions, correction status, fix guide with wrong/correct code examples, and git context.

---

### `rulecatch_rules`

List all active rules with their conditions, severity, and descriptions.

```
"What rules do I have configured?"
```

No parameters. Returns all rules with their conditions, severity levels, categories, and enabled/disabled status.

---

### `rulecatch_fix_plan`

Get a file-by-file plan of uncorrected violations to fix, with estimated time and cost.

```
"Generate a fix plan for all uncorrected errors"
```

| Parameter | Description |
|-----------|-------------|
| `period` | Time period (default: `7d`) |
| `severity` | Filter by severity (default: errors + warnings) |
| `category` | Filter by category |
| `sessionId` | Fix violations from a specific session only |

Returns: grouped-by-file list of violations with line numbers, rule descriptions, fix guidance, wrong/correct code examples, and total estimated fix time and cost.

---

### `rulecatch_top_rules`

Get the most frequently violated rules, ranked by count.

```
"Which rules am I breaking the most?"
```

| Parameter | Description |
|-----------|-------------|
| `period` | Time period (default: `7d`) |
| `severity` | Filter by severity |
| `category` | Filter by category |
| `limit` | Max rules to return (default: 10, max: 25) |

Returns: ranked list with violation counts, correction rates, percentage of total, and category breakdown.

### `rulecatch_top_rules`

Get the most frequently violated rules, ranked by count.

```
"Which rules am I breaking the most?"
```

| Parameter | Description |
|-----------|-------------|
| `period` | Time period (default: `7d`) |
| `severity` | Filter by severity |
| `category` | Filter by category |
| `limit` | Max rules to return (default: 10, max: 25) |

Returns: ranked list with violation counts, correction rates, percentage of total, and category breakdown.

## Architecture

```
Claude Code
    │
    ▼
@rulecatch/mcp-server (runs locally via stdio)
    │
    ▼ HTTPS (Bearer token auth)
    │
mcp.rulecatch.ai ─── MongoDB Atlas
```

- The MCP server runs locally on your machine as a stdio process
- It reads your API key from `~/.claude/rulecatch/config.json`
- All requests go to `mcp.rulecatch.ai` (US) or `mcp-eu.rulecatch.ai` (EU)
- No code content is ever sent — only metadata queries

## Requirements

- **Node.js** 18+
- **Rulecatch account** with Pro or Enterprise plan
- **Hooks configured** via `@rulecatch/ai-pooler init`

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Rulecatch not configured` | Missing config file | Run `npx @rulecatch/ai-pooler init` |
| `Invalid API key` | API key doesn't match | Re-run `npx @rulecatch/ai-pooler init` |
| `MCP tools require a Pro or Enterprise plan` | Starter or monitor-only mode | Upgrade at dashboard |
| `Rate limited` | Too many requests | Wait a moment, try again |
| No tools appearing in Claude | MCP config not loaded | Restart Claude Code after editing `mcp.json` |

## Links

- **Dashboard**: https://dashboard.rulecatch.ai?utm_source=npm&utm_medium=readme&utm_campaign=mcp-server&utm_content=links
- **Documentation**: https://rulecatch.ai/docs?utm_source=npm&utm_medium=readme&utm_campaign=mcp-server&utm_content=links
- **AI Pooler (hooks)**: https://www.npmjs.com/package/@rulecatch/ai-pooler
- **Privacy Policy**: https://rulecatch.ai/privacy?utm_source=npm&utm_medium=readme&utm_campaign=mcp-server&utm_content=links
- **GitHub**: https://github.com/TheDecipherist/rulecatch

## License

MIT
