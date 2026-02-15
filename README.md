# Rulecatch SDK

Official open-source packages for [Rulecatch](https://rulecatch.ai) — AI coding analytics, monitoring, and rule enforcement for Claude Code.

Track every AI coding session in real-time: tool calls, file edits, token usage, costs, and rule violations. Privacy-first with zero-knowledge encryption.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@rulecatch/ai-pooler`](./packages/ai-pooler) | CLI + hooks for tracking AI coding activity | [![npm](https://img.shields.io/npm/v/@rulecatch/ai-pooler)](https://www.npmjs.com/package/@rulecatch/ai-pooler) |
| [`@rulecatch/mcp-server`](./packages/mcp-server) | MCP server — query violations and rules from Claude Code | [![npm](https://img.shields.io/npm/v/@rulecatch/mcp-server)](https://www.npmjs.com/package/@rulecatch/mcp-server) |

## Quick Start

### Monitor AI activity (no account needed)

```bash
npx @rulecatch/ai-pooler monitor --no-api-key
```

See what your AI coding assistant is doing in real-time — tool calls, file edits, tokens, costs. Zero setup.

### Full setup (with dashboard)

```bash
# 1. Install and configure
npx @rulecatch/ai-pooler init

# 2. Start the live monitor
npx @rulecatch/ai-pooler monitor

# 3. (Optional) Add MCP server for in-IDE rule violations
# Add to ~/.claude/mcp.json:
# { "mcpServers": { "rulecatch": { "command": "npx", "args": ["-y", "@rulecatch/mcp-server"] } } }
```

## What It Tracks

- **Tool calls** — every Read, Write, Edit, Bash, Grep, Glob with success/failure and I/O size
- **Token usage** — input/output tokens per model, running totals
- **Cost** — real-time cost estimation by model (Opus, Sonnet, Haiku)
- **Code changes** — lines added/removed via git diff
- **Session timeline** — start, end, duration, active time
- **Rule violations** — custom rules enforced across your team

## Privacy

All personal data (file paths, emails, project names) is encrypted on your machine before it leaves. We use AES-256-GCM with PBKDF2 key derivation (100k iterations). Your encryption key never leaves your device.

[Read more about our privacy architecture](https://rulecatch.ai/docs/privacy)

## How It Works

```
Claude Code hooks → local buffer → flush to API → dashboard
                                                 ↓
                              rule engine → violation alerts
```

1. **Hooks** capture events from Claude Code (zero token overhead — hooks run in bash)
2. **Buffer** stores events locally as JSON files
3. **Flush** sends batched events to the Rulecatch API (encrypted)
4. **Dashboard** shows analytics, trends, and team insights
5. **Rules** are checked in real-time and violations surface in the MCP server

## Links

- [Website](https://rulecatch.ai)
- [Dashboard](https://dashboard.rulecatch.ai)
- [Documentation](https://rulecatch.ai/docs)

## License

MIT
