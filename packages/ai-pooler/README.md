# @rulecatch/ai-pooler

AI development analytics for Claude Code — track sessions, tool usage, code changes, costs, and rule violations.

**Privacy-first by design**: Zero-knowledge encryption means we literally cannot read your personal data.

## Quick Start

### Full Mode (with account)

```bash
npx @rulecatch/ai-pooler init
```

The interactive setup will:
1. Ask if you have an account (Yes / Create one / Try monitor first)
2. Validate your API key and auto-detect your region (US or EU)
3. Set up local encryption for PII (you choose the password)
4. Install hooks, flush script, and MCP server
5. Register all 14 Claude Code hook types in `~/.claude/settings.json`

That's it! Restart Claude Code and all sessions are tracked automatically.

#### Non-Interactive Setup

```bash
npx @rulecatch/ai-pooler init --api-key=dc_YOUR_KEY
```

You can also pass all options to skip prompts entirely:

```bash
npx @rulecatch/ai-pooler init \
  --api-key=dc_YOUR_KEY \
  --region=eu \
  --encryption-key=my_secret_password \
  --project-id=my-project \
  --batch-size=30
```

### Monitor-Only Mode (free, no account needed)

```bash
npx @rulecatch/ai-pooler init --monitor-only
```

Watch your AI coding activity in real-time without creating an account:
- Live event stream in your terminal
- Tool usage, token counts, cost estimates
- No data sent to any server — everything stays local
- Upgrade to full mode anytime with `npx @rulecatch/ai-pooler init --api-key=KEY`

```bash
# Start the live monitor
npx @rulecatch/ai-pooler monitor
```

You can also jump straight into the monitor without running init first:

```bash
npx @rulecatch/ai-pooler monitor --no-api-key
```

This auto-initializes in monitor-only mode and starts the live event stream immediately.

## Commands

### Setup

```bash
rulecatch init                           # Interactive setup (3-option prompt)
rulecatch init --api-key=KEY             # Non-interactive with API key
rulecatch init --monitor-only            # Monitor mode (no account needed)
rulecatch init --region=eu               # Force EU region
rulecatch init --encryption-key=PWD      # Set encryption password (min 8 chars)
rulecatch init --project-id=my-project   # Override auto-detected project name
rulecatch init --batch-size=30           # Events per flush batch (default: 20)
```

### Live Monitoring

```bash
rulecatch monitor                  # Real-time event stream (compact)
rulecatch monitor -v               # Verbose — file paths, git context, line changes
rulecatch monitor -vv              # Debug — full JSON event dump
rulecatch monitor --show-prompt    # Include user prompt previews
rulecatch monitor --no-api-key     # Force monitor-only (skips API key)
rulecatch live                     # Alias for monitor
```

### Status & Diagnostics

```bash
rulecatch status                   # Check setup health, buffer, hooks, backpressure
rulecatch check                    # View recent rule violations (last 24h)
rulecatch check --period=7d        # Violations over last 7 days (1h, 12h, 24h, 7d)
rulecatch check --quiet            # Script-friendly output (summary line only)
rulecatch check --format=json      # JSON output
```

### Configuration

```bash
rulecatch config                   # View current config
rulecatch config --show-key        # Display your encryption key
rulecatch config --region=eu       # Change data region
rulecatch config --batch-size=30   # Change batch threshold
```

### Maintenance

```bash
rulecatch flush                    # Force send buffered events
rulecatch logs                     # Show flush activity (last 30 entries)
rulecatch logs --lines=50          # Show more entries
rulecatch logs --source=hook       # Show hook activity instead of flush
rulecatch backpressure             # Show throttling status
rulecatch bp                       # Alias for backpressure
rulecatch backpressure --reset=true  # Reset backoff state
rulecatch reactivate               # Resume after subscription renewal
```

### Cleanup

```bash
rulecatch uninstall                # Remove all Rulecatch files and hooks
rulecatch remove                   # Alias for uninstall
```

## Configuration

All configuration is stored in `~/.claude/rulecatch/config.json`:

```json
{
  "apiKey": "dc_your_api_key_here",
  "projectId": "my-project",
  "region": "us",
  "batchSize": 20,
  "salt": "...",
  "encryptionKey": "...",
  "monitorOnly": false
}
```

| Field | Description |
|-------|-------------|
| `apiKey` | Your API key from the Rulecatch dashboard (empty in monitor-only mode) |
| `projectId` | Project name (auto-detected from git remote or directory name) |
| `region` | Data region: `us` (Virginia) or `eu` (Frankfurt) |
| `batchSize` | Events per flush batch (default: 20) |
| `salt` | Auto-generated salt for PII hashing |
| `encryptionKey` | Your encryption password for PII |
| `monitorOnly` | `true` for monitor-only mode (no API key required) |

The config file is created automatically by `rulecatch init`. You should never need to edit it manually.

## Auto-Update

Hooks are automatically updated when you run any `npx @rulecatch/ai-pooler` command with a newer version. The CLI compares its version against `~/.claude/rulecatch/.hook-version` and silently updates the hook and flush scripts if they differ. No manual action needed.

## What Gets Installed

Running `init` creates and registers the following:

| File | Purpose |
|------|---------|
| `~/.claude/rulecatch/config.json` | Configuration (API key, region, encryption) |
| `~/.claude/rulecatch/buffer/` | Buffered events awaiting flush |
| `~/.claude/hooks/rulecatch-track.sh` | Hook script (fires on every Claude event) |
| `~/.claude/hooks/rulecatch-flush.js` | Flush script (sends buffer to API) |
| `~/.claude/rulecatch/mcp-server.js` | MCP server for Rulecatch tools (full mode only) |
| `~/.claude/settings.json` | Hooks + MCP server registered here |

All 14 Claude Code hook types are registered: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, SubagentStart, SubagentStop, Stop, TeammateIdle, TaskCompleted, PreCompact.

## Privacy & Security

We take your privacy seriously. Rulecatch uses **zero-knowledge architecture** — we cannot read your personal data even if we wanted to.

### Zero-Knowledge Encryption

During setup, you provide an encryption password. This password:
- Is stored **only on your machine** (in the config file)
- Encrypts all PII before it leaves your machine
- Is never sent to Rulecatch servers
- Is needed in the dashboard to decrypt your own data

### What This Means

| Data Type | What We Receive |
|-----------|-----------------|
| Email | `a7f3b2c1...` (encrypted) |
| Git username | `e9d4f1a8...` (encrypted) |
| File paths | `b2c3d4e5...` (encrypted) |
| Tool calls | `Read`, `Edit`, `Bash` (unchanged) |
| Token counts | `15,234` (unchanged) |

### GDPR Compliance

- **EU Data Residency**: Choose EU region during setup to store data in Frankfurt
- **Right to Deletion**: Delete all your data anytime from the dashboard
- **Right to Access**: Export all your data in machine-readable format
- **Data Minimization**: We only collect what's needed for analytics
- **Client-Side Control**: Your machine decides where data goes, not us

## What Gets Tracked

Via Claude Code hooks, we automatically capture:

- **Session start/end** — When you begin and end coding sessions
- **Tool calls** — Every Read, Write, Edit, Bash, Glob, Grep call (name, success/failure)
- **File paths** — Which files tools operate on (encrypted before sending)
- **Languages used** — Inferred from file extensions (TypeScript, Python, etc.)
- **Lines changed** — Actual `git diff` stats captured incrementally
- **Files modified** — List of changed files from git (encrypted before sending)
- **Git context** — Repository, branch, commit, dirty state
- **Turn completions** — When Claude finishes responding
- **User prompts** — Prompt length and metadata (not content)
- **Subagent activity** — Start/stop of subagents and teammates
- **Permission requests** — When tools request elevated permissions
- **Context compaction** — When conversation context is compressed
- **Token usage** — Input/output tokens (calculated from Claude's stats)
- **Cost estimates** — Based on model and token usage

### What We Never Collect

- **No code content** — We never see your actual code
- **No keystrokes** — We never capture what you type
- **No prompt content** — Your conversations stay private
- **No file content** — Only metadata, never the actual files

## How It Works

```
+-----------------------------------------------+
|          YOUR MACHINE (Full Control)           |
|                                                |
|  Claude Code -> Hook fires -> Privacy check    |
|                      |                         |
|          PII encrypted locally (AES-256-GCM)   |
|                      |                         |
|     Region check -> Route to US or EU API      |
+-----------------------------------------------+
                       |
          +------------+------------+
          |                         |
+---------+---------+   +---------+---------+
|  US API (Virginia) |   |  EU API (Frankfurt)|
|                    |   |                    |
|  We receive:       |   |  We receive:       |
|  - Encrypted PII   |   |  - Encrypted PII   |
|  - Plain metrics   |   |  - Plain metrics   |
|                    |   |                    |
|  We CANNOT see:    |   |  We CANNOT see:    |
|  - Your email      |   |  - Your email      |
|  - Your username   |   |  - Your username   |
|  - Your file paths |   |  - Your file paths |
+--------------------+   +--------------------+
```

## Links

- **Dashboard**: https://dashboard.rulecatch.ai?utm_source=npm&utm_medium=readme&utm_campaign=ai-pooler&utm_content=links
- **Documentation**: https://rulecatch.ai/docs?utm_source=npm&utm_medium=readme&utm_campaign=ai-pooler&utm_content=links
- **Privacy Policy**: https://rulecatch.ai/privacy?utm_source=npm&utm_medium=readme&utm_campaign=ai-pooler&utm_content=links
- **GitHub**: https://github.com/TheDecipherist/rulecatch-sdk

## License

MIT
