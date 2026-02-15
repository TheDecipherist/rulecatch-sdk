# @rulecatch/ai-pooler

AI development analytics for Claude Code, Cursor, and other AI coding assistants.

Track your AI-assisted development sessions: tool usage, code changes, productivity patterns, and costs.

**Privacy-first by design**: Zero-knowledge encryption means we literally cannot read your personal data.

## Quick Start

```bash
# Install globally
npm install -g @rulecatch/ai-pooler

# Set up automatic tracking (interactive)
rulecatch init
```

The interactive setup will:
1. Ask for your API key (from the dashboard)
2. Validate your key and detect your region
3. Set up local encryption for PII
4. Install hooks and configure everything

That's it! All your Claude Code sessions will now be tracked automatically.

## Configuration

All configuration is stored in `~/.claude/rulecatch/config.json`:

```json
{
  "apiKey": "dc_your_api_key_here",
  "region": "us",
  "batchSize": 20,
  "salt": "...",
  "encryptionKey": "..."
}
```

| Field | Description |
|-------|-------------|
| `apiKey` | Your API key from the Rulecatch™ dashboard |
| `region` | Data region: `us` (Virginia) or `eu` (Frankfurt) |
| `batchSize` | Events per flush batch (default: 20) |
| `salt` | Auto-generated salt for PII hashing |
| `encryptionKey` | Your encryption password for PII |

The config file is created automatically by `rulecatch init`. You should never need to edit it manually.

## Privacy & Security

We take your privacy seriously. Rulecatch™ uses **zero-knowledge architecture** — we cannot read your personal data even if we wanted to.

### Zero-Knowledge Encryption

During setup, you provide an encryption password. This password:
- Is stored **only on your machine** (in the config file)
- Encrypts all PII before it leaves your machine
- Is never sent to Rulecatch™ servers
- Is needed in the dashboard to decrypt your own data

### What This Means

| Data Type | What We Receive |
|-----------|-----------------|
| Email | `a7f3b2c1...` (SHA-256 hash) |
| Git username | `e9d4f1a8...` (SHA-256 hash) |
| File paths | `b2c3d4e5...` (SHA-256 hash) |
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
- **File paths** — Which files tools operate on (hashed before sending)
- **Languages used** — Inferred from file extensions (TypeScript, Python, etc.)
- **Lines changed** — Actual `git diff` stats captured incrementally
- **Files modified** — List of changed files from git (hashed before sending)
- **Git context** — Repository, branch, commit, dirty state
- **Turn completions** — When Claude finishes responding
- **Token usage** — Input/output tokens (calculated from Claude's stats)
- **Cost estimates** — Based on model and token usage

### What We Never Collect

- **No code content** — We never see your actual code
- **No keystrokes** — We never capture what you type
- **No prompt content** — Your conversations stay private
- **No file content** — Only metadata, never the actual files

## Commands

```bash
# Interactive setup (run once)
rulecatch init

# Check setup status
rulecatch status

# Send test event
rulecatch test

# View recent activity
rulecatch logs

# Remove tracking
rulecatch uninstall

# Show help
rulecatch help
```

## How It Works

```
+-----------------------------------------------+
|          YOUR MACHINE (Full Control)           |
|                                                |
|  Claude Code -> Hook fires -> Privacy check    |
|                      |                         |
|          PII hashed locally (SHA-256)          |
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
|  - Hashed PII      |   |  - Hashed PII      |
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
- **GitHub**: https://github.com/TheDecipherist/rulecatch

## License

MIT
