#!/bin/bash
# Rulecatch AI tracking hook - Auto-generated
# Writes events to buffer files for batch processing
# Supports: Zero-knowledge encryption, Regional routing, Adaptive throttling

# Debug logging - set RULECATCH_DEBUG=true for verbose output
DEBUG="${RULECATCH_DEBUG:-false}"
LOG_FILE="/tmp/rulecatch-hook.log"

log() {
  echo "[$(date)] $1" >> "$LOG_FILE"
}

log_debug() {
  if [ "$DEBUG" == "true" ]; then
    echo "[$(date)] [DEBUG] $1" >> "$LOG_FILE"
  fi
}

log "Hook called"

# ============================================================================
# CONFIGURATION
# ============================================================================

CONFIG_DIR="$HOME/.claude/rulecatch"
CONFIG_FILE="$CONFIG_DIR/config.json"
BUFFER_DIR="$CONFIG_DIR/buffer"
FLUSH_SCRIPT="$HOME/.claude/hooks/rulecatch-flush.js"

# Exit if not configured
[ ! -f "$CONFIG_FILE" ] && exit 0

# Exit if data collection is paused (subscription expired)
# User must run `npx @rulecatch/ai-pooler reactivate` to resume
PAUSED_FILE="$CONFIG_DIR/.paused"
[ -f "$PAUSED_FILE" ] && exit 0

# Read config (single file read, multiple jq parses)
CONFIG_DATA=$(cat "$CONFIG_FILE")
API_KEY=$(echo "$CONFIG_DATA" | jq -r '.apiKey // empty')
MONITOR_ONLY=$(echo "$CONFIG_DATA" | jq -r '.monitorOnly // false')

# Exit if no API key AND not in monitor-only mode
[ -z "$API_KEY" ] && [ "$MONITOR_ONLY" != "true" ] && exit 0

REGION=$(echo "$CONFIG_DATA" | jq -r '.region // "us"')
ENCRYPTION_KEY=$(echo "$CONFIG_DATA" | jq -r '.encryptionKey // empty')
SALT=$(echo "$CONFIG_DATA" | jq -r '.salt // "rulecatch"')

# Ensure buffer directory exists
mkdir -p "$BUFFER_DIR"

# Determine if privacy/encryption is enabled
PRIVACY_ENABLED="false"
if [ -n "$ENCRYPTION_KEY" ]; then
  PRIVACY_ENABLED="true"
fi

# ============================================================================
# ENCRYPTION FUNCTIONS
# Uses AES-256-GCM with PBKDF2 key derivation
# Format: iv_base64:ciphertext_base64 (compatible with browser Web Crypto API)
# ============================================================================

# Encrypt a single value using AES-256-GCM
encrypt_pii() {
  local plaintext="$1"

  if [ -z "$plaintext" ] || [ "$PRIVACY_ENABLED" != "true" ]; then
    echo "$plaintext"
    return
  fi

  # Use Python for reliable PBKDF2 + AES-GCM (matches browser Web Crypto)
  python3 - "$plaintext" "$ENCRYPTION_KEY" <<'PYEOF' 2>/dev/null
import sys
import os
import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

plaintext = sys.argv[1]
password = sys.argv[2]

# Derive key using PBKDF2 (must match browser: salt="rulecatch", iterations=100000)
kdf = PBKDF2HMAC(
    algorithm=hashes.SHA256(),
    length=32,
    salt=b'rulecatch',
    iterations=100000,
)
key = kdf.derive(password.encode())

# Generate random IV (12 bytes for GCM)
iv = os.urandom(12)

# Encrypt with AES-256-GCM
aesgcm = AESGCM(key)
ciphertext = aesgcm.encrypt(iv, plaintext.encode(), None)

# Output format: iv:ciphertext (both base64)
print(base64.b64encode(iv).decode() + ':' + base64.b64encode(ciphertext).decode())
PYEOF

  # If Python encryption failed, return original value
  if [ $? -ne 0 ]; then
    echo "$plaintext"
  fi
}

# Hash a value for searchable indexing (one-way, for grouping/filtering)
hash_for_index() {
  local plaintext="$1"
  if [ -z "$plaintext" ]; then
    echo ""
    return
  fi
  # Truncated SHA256 hash with salt
  echo -n "${plaintext}${SALT}" | sha256sum | cut -c1-16
}

# ============================================================================
# MAIN LOGIC
# ============================================================================

# Read JSON from stdin
INPUT=$(cat)

# Extract hook event name
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Capture git info (resolve CWD to git root + gather context in single check)
log_debug "CWD=$CWD"
GIT_USERNAME="" GIT_EMAIL="" GIT_REPO="" GIT_BRANCH="" GIT_COMMIT="" GIT_DIRTY="false"
if [ -n "$CWD" ] && (cd "$CWD" && git rev-parse --git-dir >/dev/null 2>&1); then
  CWD=$(cd "$CWD" && git rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
  GIT_USERNAME=$(cd "$CWD" && git config user.name 2>/dev/null || echo "")
  GIT_EMAIL=$(cd "$CWD" && git config user.email 2>/dev/null || echo "")
  GIT_REPO=$(cd "$CWD" && git remote get-url origin 2>/dev/null || echo "")
  GIT_BRANCH=$(cd "$CWD" && git branch --show-current 2>/dev/null || echo "")
  GIT_COMMIT=$(cd "$CWD" && git rev-parse --short HEAD 2>/dev/null || echo "")
  GIT_DIRTY=$(cd "$CWD" && [ -n "$(git status --porcelain 2>/dev/null)" ] && echo "true" || echo "false")
  log_debug "Git: user=$GIT_USERNAME, repo=$GIT_REPO, branch=$GIT_BRANCH"
fi

# ============================================================================
# ENCRYPT PII FIELDS
# ============================================================================

# Auto-detect project ID from git repo name (BEFORE encryption clears CWD)
PROJECT_ID=""
if [ -n "$GIT_REPO" ]; then
  # Extract repo name from URL (handles both HTTPS and SSH)
  PROJECT_ID=$(echo "$GIT_REPO" | sed 's/.*[/:]\([^/]*\)\.git$/\1/' | sed 's/.*[/:]\([^/]*\)$/\1/')
fi
if [ -z "$PROJECT_ID" ] && [ -n "$CWD" ]; then
  PROJECT_ID=$(basename "$CWD")
fi
[ -z "$PROJECT_ID" ] && PROJECT_ID="unknown"

# Initialize encrypted/hash variables
GIT_USERNAME_ENCRYPTED=""
GIT_EMAIL_ENCRYPTED=""
CWD_ENCRYPTED=""
PROJECT_ID_ENCRYPTED=""
GIT_USERNAME_HASH=""
GIT_EMAIL_HASH=""
CWD_HASH=""
PROJECT_ID_HASH=""

# If privacy is enabled, encrypt PII fields (decryptable) + create hashes (for indexing)
if [ "$PRIVACY_ENABLED" == "true" ]; then
  GIT_USERNAME_ENCRYPTED=$(encrypt_pii "$GIT_USERNAME")
  GIT_EMAIL_ENCRYPTED=$(encrypt_pii "$GIT_EMAIL")
  CWD_ENCRYPTED=$(encrypt_pii "$CWD")
  PROJECT_ID_ENCRYPTED=$(encrypt_pii "$PROJECT_ID")

  GIT_USERNAME_HASH=$(hash_for_index "$GIT_USERNAME")
  GIT_EMAIL_HASH=$(hash_for_index "$GIT_EMAIL")
  CWD_HASH=$(hash_for_index "$CWD")
  PROJECT_ID_HASH=$(hash_for_index "$PROJECT_ID")

  # Clear plaintext values
  GIT_USERNAME=""
  GIT_EMAIL=""
  CWD=""
  PROJECT_ID=""
fi

# ============================================================================
# BUILD EVENT PAYLOAD
# ============================================================================

# Common base JSON (shared by session_start, session_end, tool_call)
TIMESTAMP_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Incremental active time: delta since last event (ms)
ACTIVE_TIME_MS=0
LAST_EVENT_FILE="/tmp/rulecatch-last-event-$SESSION_ID.epoch"
if [ -f "$LAST_EVENT_FILE" ]; then
  LAST_EPOCH=$(cat "$LAST_EVENT_FILE")
  NOW_EPOCH=$(date +%s)
  ACTIVE_TIME_MS=$(( (NOW_EPOCH - LAST_EPOCH) * 1000 ))
  echo "$NOW_EPOCH" > "$LAST_EVENT_FILE"
fi

BASE_JSON=$(jq -n \
  --arg sessionId "$SESSION_ID" \
  --arg hookEvent "$HOOK_EVENT" \
  --arg projectId "$PROJECT_ID" \
  --arg projectIdEncrypted "$PROJECT_ID_ENCRYPTED" \
  --arg projectIdHash "$PROJECT_ID_HASH" \
  --arg cwd "$CWD" \
  --arg cwdEncrypted "$CWD_ENCRYPTED" \
  --arg cwdHash "$CWD_HASH" \
  --arg timestamp "$TIMESTAMP_ISO" \
  --arg gitUsername "$GIT_USERNAME" \
  --arg gitUsernameEncrypted "$GIT_USERNAME_ENCRYPTED" \
  --arg gitUsernameHash "$GIT_USERNAME_HASH" \
  --arg gitEmail "$GIT_EMAIL" \
  --arg gitEmailEncrypted "$GIT_EMAIL_ENCRYPTED" \
  --arg gitEmailHash "$GIT_EMAIL_HASH" \
  --arg gitRepo "$GIT_REPO" \
  --arg gitBranch "$GIT_BRANCH" \
  --arg gitCommit "$GIT_COMMIT" \
  --argjson gitDirty "$GIT_DIRTY" \
  --argjson activeTime "$ACTIVE_TIME_MS" \
  '$ARGS.named')

# ============================================================================
# MODEL DETECTION + INCREMENTAL LINES (EVERY EVENT)
# ALL data flows with EVERY event — NEVER depends on session_end alone
# stats-cache.json does NOT update during sessions, so we use byte estimates
# for tokens/cost. Model is detected from the latest day in stats-cache.
# ============================================================================

STATS_FILE="$HOME/.claude/stats-cache.json"
MODEL_CACHE="/tmp/rulecatch-model-$SESSION_ID"
INC_MODEL=""

# Detect model: use cached value, or read from stats-cache.json latest day
if [ -f "$MODEL_CACHE" ]; then
  INC_MODEL=$(cat "$MODEL_CACHE")
elif [ -f "$STATS_FILE" ]; then
  # Get model from the latest day's tokensByModel entry
  INC_MODEL=$(cat "$STATS_FILE" | jq -r '.dailyModelTokens[-1].tokensByModel | to_entries | sort_by(-.value) | .[0].key // empty' 2>/dev/null)
  if [ -n "$INC_MODEL" ]; then
    echo "$INC_MODEL" > "$MODEL_CACHE"
  fi
fi

# Incremental git diff (lines added/removed since last event)
INC_LINES_ADDED=0
INC_LINES_REMOVED=0
ORIG_CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -n "$ORIG_CWD" ] && (cd "$ORIG_CWD" && git rev-parse --git-dir >/dev/null 2>&1); then
  C_ADD=0; C_REM=0
  DIFF_DATA=$(cd "$ORIG_CWD" && { git diff --numstat HEAD 2>/dev/null; git diff --numstat --cached 2>/dev/null; } | grep -v '^$')
  if [ -n "$DIFF_DATA" ]; then
    while IFS=$'\t' read -r a r f; do
      [ "$a" != "-" ] && [ "$r" != "-" ] && C_ADD=$((C_ADD + a)) && C_REM=$((C_REM + r))
    done <<< "$DIFF_DATA"
  fi

  LS="/tmp/rulecatch-lines-last-$SESSION_ID"
  if [ -f "$LS" ]; then
    PA=$(awk 'NR==1' "$LS"); PR=$(awk 'NR==2' "$LS")
    INC_LINES_ADDED=$((C_ADD - PA)); INC_LINES_REMOVED=$((C_REM - PR))
    [ "$INC_LINES_ADDED" -lt 0 ] && INC_LINES_ADDED=0
    [ "$INC_LINES_REMOVED" -lt 0 ] && INC_LINES_REMOVED=0
  else
    INC_LINES_ADDED=$C_ADD; INC_LINES_REMOVED=$C_REM
  fi
  printf '%s\n%s\n' "$C_ADD" "$C_REM" > "$LS"
fi

log_debug "Incremental: model=$INC_MODEL +$INC_LINES_ADDED/-$INC_LINES_REMOVED"

case "$HOOK_EVENT" in
  "SessionStart")
    STATS_FILE="$HOME/.claude/stats-cache.json"
    if [ -f "$STATS_FILE" ]; then
      cp "$STATS_FILE" "/tmp/rulecatch-stats-start-$SESSION_ID.json"
    fi

    # Save epoch for incremental active time calculation (every event sends delta)
    date +%s > "/tmp/rulecatch-last-event-$SESSION_ID.epoch"

    # Initialize incremental lines tracking snapshot
    printf '0\n0\n' > "/tmp/rulecatch-lines-last-$SESSION_ID"

    # Detect possible /clear (SessionEnd happened within last 5 seconds)
    POSSIBLE_CLEAR="false"
    CLEAR_MARKER="/tmp/rulecatch-session-end-marker"
    if [ -f "$CLEAR_MARKER" ]; then
      MARKER_TIME=$(cat "$CLEAR_MARKER" 2>/dev/null || echo "0")
      NOW_EPOCH=$(date +%s)
      ELAPSED=$((NOW_EPOCH - MARKER_TIME))
      if [ "$ELAPSED" -le 5 ]; then
        POSSIBLE_CLEAR="true"
        log "Detected possible /clear (SessionEnd was ${ELAPSED}s ago)"
      fi
      rm -f "$CLEAR_MARKER"
    fi

    CLAUDE_VERSION=$(echo "$INPUT" | jq -r '.version // empty')

    # Get account info
    ACCOUNT_EMAIL=""
    ORG_NAME=""
    BILLING_TYPE=""
    HAS_OPUS_DEFAULT="false"

    for f in "$HOME/.claude/"*.json; do
      if [ -f "$f" ]; then
        EMAIL=$(jq -r '.oauthAccount.emailAddress // empty' "$f" 2>/dev/null)
        if [ -n "$EMAIL" ]; then
          ACCOUNT_EMAIL="$EMAIL"
          ORG_NAME=$(jq -r '.oauthAccount.organizationName // empty' "$f" 2>/dev/null)
          BILLING_TYPE=$(jq -r '.oauthAccount.organizationBillingType // empty' "$f" 2>/dev/null)
          HAS_OPUS_DEFAULT=$(jq -r '.hasOpusPlanDefault // false' "$f" 2>/dev/null)
          break
        fi
      fi
    done

    # Encrypt/hash account email if privacy enabled
    ACCOUNT_EMAIL_ENCRYPTED=""
    ACCOUNT_EMAIL_HASH=""
    if [ "$PRIVACY_ENABLED" == "true" ]; then
      ACCOUNT_EMAIL_ENCRYPTED=$(encrypt_pii "$ACCOUNT_EMAIL")
      ACCOUNT_EMAIL_HASH=$(hash_for_index "$ACCOUNT_EMAIL")
      ACCOUNT_EMAIL=""
    fi

    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "session_start" \
      --arg claudeVersion "$CLAUDE_VERSION" \
      --arg accountEmail "$ACCOUNT_EMAIL" \
      --arg accountEmailEncrypted "$ACCOUNT_EMAIL_ENCRYPTED" \
      --arg accountEmailHash "$ACCOUNT_EMAIL_HASH" \
      --arg orgName "$ORG_NAME" \
      --arg billingType "$BILLING_TYPE" \
      --argjson hasOpusDefault "$HAS_OPUS_DEFAULT" \
      --arg region "$REGION" \
      --argjson privacyEnabled "$PRIVACY_ENABLED" \
      --argjson possibleContextClear "$POSSIBLE_CLEAR" \
      '. + {type: $type, claudeVersion: $claudeVersion, accountEmail: $accountEmail, accountEmailEncrypted: $accountEmailEncrypted, accountEmailHash: $accountEmailHash, orgName: $orgName, billingType: $billingType, hasOpusDefault: $hasOpusDefault, region: $region, privacyEnabled: $privacyEnabled, possibleContextClear: $possibleContextClear}')
    ;;

  "SessionEnd")
    # Write marker so next SessionStart can detect possible /clear
    echo "$(date +%s)" > "/tmp/rulecatch-session-end-marker"

    # Get list of modified files (session-level summary)
    FILES_CHANGED=0
    CHANGED_FILES_JSON="[]"
    CHANGED_FILES_HASHES="[]"
    ORIGINAL_CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

    if [ -n "$ORIGINAL_CWD" ] && (cd "$ORIGINAL_CWD" && git rev-parse --git-dir >/dev/null 2>&1); then
      if [ "$PRIVACY_ENABLED" == "true" ]; then
        FILES_LIST=$(cd "$ORIGINAL_CWD" && git diff --name-only HEAD 2>/dev/null)
        FILES_CHANGED=$(echo "$FILES_LIST" | grep -c '.' 2>/dev/null || echo 0)
        CHANGED_FILES_HASHES=$(echo "$FILES_LIST" | while read f; do [ -n "$f" ] && hash_for_index "$f"; done | jq -R -s 'split("\n") | map(select(length > 0))')
        CHANGED_FILES_JSON="[]"
      else
        CHANGED_FILES_JSON=$(cd "$ORIGINAL_CWD" && git diff --name-only HEAD 2>/dev/null | jq -R -s 'split("\n") | map(select(length > 0))')
        FILES_CHANGED=$(echo "$CHANGED_FILES_JSON" | jq 'length' 2>/dev/null || echo 0)
      fi
      [ -z "$CHANGED_FILES_JSON" ] && CHANGED_FILES_JSON="[]"
      [ -z "$CHANGED_FILES_HASHES" ] && CHANGED_FILES_HASHES="[]"
    fi

    # Encrypt file paths if privacy enabled
    CHANGED_FILES_ENCRYPTED="[]"
    if [ "$PRIVACY_ENABLED" == "true" ] && [ "$CHANGED_FILES_JSON" != "[]" ]; then
      CHANGED_FILES_ENCRYPTED=$(echo "$CHANGED_FILES_JSON" | jq -r '.[]' | while read f; do
        encrypted=$(encrypt_pii "$f")
        echo "\"$encrypted\""
      done | jq -s '.')
    fi

    # Lines come from incremental git diff; tokens sent incrementally via tool_call
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "session_end" \
      --argjson linesAdded "$INC_LINES_ADDED" \
      --argjson linesRemoved "$INC_LINES_REMOVED" \
      --argjson filesChanged "$FILES_CHANGED" \
      --argjson filesModified "$CHANGED_FILES_JSON" \
      --argjson filesModifiedEncrypted "$CHANGED_FILES_ENCRYPTED" \
      --argjson filesModifiedHashes "$CHANGED_FILES_HASHES" \
      --arg model "$INC_MODEL" \
      '. + {type: $type, linesAdded: $linesAdded, linesRemoved: $linesRemoved, filesChanged: $filesChanged, filesModified: $filesModified, filesModifiedEncrypted: $filesModifiedEncrypted, filesModifiedHashes: $filesModifiedHashes, model: $model}')

    # Clean up temp files
    rm -f "/tmp/rulecatch-stats-start-$SESSION_ID.json"
    rm -f "/tmp/rulecatch-lines-last-$SESSION_ID"
    rm -f "$MODEL_CACHE"
    ;;

  "PostToolUse"|"PostToolUseFailure")
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
    TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
    TOOL_RESPONSE=$(echo "$INPUT" | jq -c '.tool_response // {}')
    SUCCESS=$([[ "$HOOK_EVENT" == "PostToolUse" ]] && echo "true" || echo "false")
    FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // empty')

    INPUT_SIZE=$(echo "$TOOL_INPUT" | wc -c)
    OUTPUT_SIZE=$(echo "$TOOL_RESPONSE" | wc -c)
    TOOL_INPUT_TOKENS=$((INPUT_SIZE / 4))
    TOOL_OUTPUT_TOKENS=$((OUTPUT_SIZE / 4))

    # Truncate tool input/output for rule matching (max 4KB each)
    TOOL_INPUT_TRUNCATED=$(echo "$TOOL_INPUT" | head -c 4096)
    TOOL_OUTPUT_TRUNCATED=$(echo "$TOOL_RESPONSE" | head -c 4096)

    # Save original file path for language detection before encryption
    FILE_PATH_ORIGINAL="$FILE_PATH"

    # Encrypt/hash file path if privacy enabled
    FILE_PATH_ENCRYPTED=""
    FILE_PATH_HASH=""
    if [ "$PRIVACY_ENABLED" == "true" ] && [ -n "$FILE_PATH" ]; then
      FILE_PATH_ENCRYPTED=$(encrypt_pii "$FILE_PATH")
      FILE_PATH_HASH=$(hash_for_index "$FILE_PATH")
      FILE_PATH=""
    fi

    # Detect language from original path
    LANGUAGE=""
    if [ -n "$FILE_PATH_ORIGINAL" ]; then
      EXT="${FILE_PATH_ORIGINAL##*.}"
      case "$EXT" in
        ts|tsx) LANGUAGE="typescript" ;;
        js|jsx|mjs|cjs) LANGUAGE="javascript" ;;
        py) LANGUAGE="python" ;;
        rs) LANGUAGE="rust" ;;
        go) LANGUAGE="go" ;;
        java) LANGUAGE="java" ;;
        rb) LANGUAGE="ruby" ;;
        php) LANGUAGE="php" ;;
        cs) LANGUAGE="csharp" ;;
        cpp|cc|cxx|c|h|hpp) LANGUAGE="cpp" ;;
        swift) LANGUAGE="swift" ;;
        kt|kts) LANGUAGE="kotlin" ;;
        sh|bash|zsh) LANGUAGE="shell" ;;
        sql) LANGUAGE="sql" ;;
        html|htm) LANGUAGE="html" ;;
        css|scss|sass|less) LANGUAGE="css" ;;
        json) LANGUAGE="json" ;;
        yaml|yml) LANGUAGE="yaml" ;;
        md|mdx) LANGUAGE="markdown" ;;
        *) LANGUAGE="other" ;;
      esac
    fi

    case "$TOOL_NAME" in
      "Edit") FILE_OP="edit" ;;
      "Write") FILE_OP="write" ;;
      "Read") FILE_OP="read" ;;
      "Bash")
        BASH_CMD_FULL=$(echo "$TOOL_INPUT" | jq -r '.command // empty')

        # Command classification table: "regex@@label" (first match wins)
        CMD_CLASSES=(
          '(^|&& |; )git @@git'
          '(^|&& |; )gh @@gh'
          '(^|&& |; )(npm|npx|pnpm|yarn|bun) @@npm'
          '(^|&& |; )(node|tsx|ts-node|python|python3|pip|pip3) @@node'
          '(^|&& |; )(vitest|jest|playwright|pytest|mocha|cypress) @@test'
          '(^|&& |; )(docker|docker-compose) @@docker'
          '(^|&& |; )(kubectl|helm|terraform|pulumi) @@k8s'
          '(^|&& |; )(ssh|scp|rsync|sftp) @@ssh'
          '(^|&& |; )(curl|wget|httpie) @@http'
          '(^|&& |; )(make|cmake|cargo|go) @@build'
          '(^|&& |; )(nginx|caddy|traefik|apache2|httpd) @@server'
          '(^|&& |; )(mongo|mongosh|mongodump|mongorestore|redis-cli|psql|mysql) @@db'
          '(^|&& |; )(mitmproxy|mitmweb|mitmdump|tcpdump|wireshark|nmap) @@network'
          '(^|&& |; )(vim|vi|nvim|nano|emacs) @@editor'
          '(^|&& |; )(cat|head|tail|less|more|wc|sort|uniq|awk|sed|cut|tr|tee) @@fileutil'
          '(^|&& |; )(ls|cp|mv|rm|mkdir|rmdir|chmod|chown|ln|touch|find|locate|du|df|stat) @@fs'
          '(^|&& |; )(ps|top|htop|kill|pkill|systemctl|service|journalctl) @@process'
          '(^|&& |; )(sh|bash|zsh|source|\.) @@shell'
        )
        FILE_OP="bash"
        for entry in "${CMD_CLASSES[@]}"; do
          if echo "$BASH_CMD_FULL" | grep -qE "${entry%%@@*}"; then
            FILE_OP="${entry##*@@}"
            break
          fi
        done

        # Destructive command detection table: "regex@@reason" (first match wins)
        DESTRUCTIVE_CMDS=(
          'rm -rf @@rm -rf'
          'rm -r @@rm -r'
          '(^|&& |; )rm @@rm'
          '(^|&& |; )mv @@mv'
          'rmdir @@rmdir'
          'git reset --hard@@git reset --hard'
          'git clean -f@@git clean -f'
          'git push --force|git push -f @@git push --force'
          'git branch -D @@git branch -D'
          'git stash drop|git stash clear@@git stash drop'
          'git checkout -- |git restore \.@@git restore'
          'docker rm @@docker rm'
          'docker rmi @@docker rmi'
          'docker system prune|docker volume prune@@docker prune'
          'kubectl delete @@kubectl delete'
          'terraform destroy@@terraform destroy'
          'npm unpublish@@npm unpublish'
          'pip uninstall|pip3 uninstall@@pip uninstall'
          'drop |DROP @@DROP'
          'truncate |TRUNCATE @@TRUNCATE'
          'FLUSHALL|FLUSHDB@@FLUSHALL'
          'dropDatabase@@dropDatabase'
          'kill -9 |pkill -9 |killall @@kill -9'
          'chmod 777@@chmod 777'
        )
        DESTRUCTIVE="false"
        DESTRUCTIVE_REASON=""
        for entry in "${DESTRUCTIVE_CMDS[@]}"; do
          if echo "$BASH_CMD_FULL" | grep -qE "${entry%%@@*}"; then
            DESTRUCTIVE="true"
            DESTRUCTIVE_REASON="${entry##*@@}"
            break
          fi
        done

        # Warning commands (yellow ⚠): "regex@@reason" (monitor shows destructive over warning)
        WARNING_CMDS=(
          '(^|&& |; )chmod @@chmod'
          '(^|&& |; )chown @@chown'
          'git rebase@@git rebase'
          'docker stop @@docker stop'
          'docker push @@docker push'
          'kubectl apply @@kubectl apply'
          'terraform apply@@terraform apply'
          'systemctl stop|systemctl restart|systemctl disable@@systemctl'
          '(^|&& |; )passwd @@passwd'
        )
        WARNING="false"
        WARNING_REASON=""
        for entry in "${WARNING_CMDS[@]}"; do
          if echo "$BASH_CMD_FULL" | grep -qE "${entry%%@@*}"; then
            WARNING="true"
            WARNING_REASON="${entry##*@@}"
            break
          fi
        done

        # Sudo detection
        SUDO="false"
        if echo "$BASH_CMD_FULL" | grep -qE '(^|&& |; )sudo '; then
          SUDO="true"
        fi
        ;;
      "Glob"|"Grep") FILE_OP="search" ;;
      "Task") FILE_OP="agent" ;;
      "WebFetch"|"WebSearch") FILE_OP="web" ;;
      *) FILE_OP="other" ;;
    esac

    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "tool_call" \
      --arg toolName "$TOOL_NAME" \
      --argjson toolSuccess "$SUCCESS" \
      --arg filePath "$FILE_PATH" \
      --arg filePathEncrypted "$FILE_PATH_ENCRYPTED" \
      --arg filePathHash "$FILE_PATH_HASH" \
      --argjson toolInputSize "$TOOL_INPUT_TOKENS" \
      --argjson toolOutputSize "$TOOL_OUTPUT_TOKENS" \
      --arg toolInput "$TOOL_INPUT_TRUNCATED" \
      --arg toolOutput "$TOOL_OUTPUT_TRUNCATED" \
      --arg language "$LANGUAGE" \
      --arg fileOperation "$FILE_OP" \
      --argjson destructive "${DESTRUCTIVE:-false}" \
      --arg destructiveReason "${DESTRUCTIVE_REASON:-}" \
      --argjson warning "${WARNING:-false}" \
      --arg warningReason "${WARNING_REASON:-}" \
      --argjson sudo "${SUDO:-false}" \
      --arg model "$INC_MODEL" \
      --argjson linesAdded "$INC_LINES_ADDED" \
      --argjson linesRemoved "$INC_LINES_REMOVED" \
      '. + {type: $type, toolName: $toolName, toolSuccess: $toolSuccess, filePath: $filePath, filePathEncrypted: $filePathEncrypted, filePathHash: $filePathHash, toolInputSize: $toolInputSize, toolOutputSize: $toolOutputSize, toolInput: $toolInput, toolOutput: $toolOutput, language: $language, fileOperation: $fileOperation, destructive: $destructive, destructiveReason: $destructiveReason, warning: $warning, warningReason: $warningReason, sudo: $sudo, model: $model, linesAdded: $linesAdded, linesRemoved: $linesRemoved}')
    ;;

  "Stop")
    STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "turn_complete" \
      --argjson stopHookActive "$STOP_HOOK_ACTIVE" \
      '. + {type: $type, stopHookActive: $stopHookActive}')
    ;;

  "PreCompact")
    TRIGGER=$(echo "$INPUT" | jq -r '.trigger // "auto"')
    CUSTOM_INSTRUCTIONS=$(echo "$INPUT" | jq -r '.custom_instructions // empty')
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "compaction_start" \
      --arg trigger "$TRIGGER" \
      --arg customInstructions "$CUSTOM_INSTRUCTIONS" \
      '. + {type: $type, trigger: $trigger, customInstructions: $customInstructions}')
    ;;

  "UserPromptSubmit")
    # User submitted a prompt — capture the prompt text (truncated for privacy)
    PROMPT_TEXT=$(echo "$INPUT" | jq -r '.prompt // empty' | head -c 4096)
    PROMPT_LENGTH=$(echo "$INPUT" | jq -r '.prompt // empty' | wc -c)
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "user_prompt" \
      --arg prompt "$PROMPT_TEXT" \
      --argjson promptLength "$PROMPT_LENGTH" \
      '. + {type: $type, prompt: $prompt, promptLength: $promptLength}')
    ;;

  "PreToolUse")
    # Before tool execution — capture intent (we never block, just observe)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
    TOOL_USE_ID=$(echo "$INPUT" | jq -r '.tool_use_id // empty')
    TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
    INPUT_SIZE=$(echo "$TOOL_INPUT" | wc -c)
    TOOL_INPUT_TRUNCATED=$(echo "$TOOL_INPUT" | head -c 4096)
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "pre_tool_use" \
      --arg toolName "$TOOL_NAME" \
      --arg toolUseId "$TOOL_USE_ID" \
      --arg toolInput "$TOOL_INPUT_TRUNCATED" \
      --argjson toolInputSize "$INPUT_SIZE" \
      '. + {type: $type, toolName: $toolName, toolUseId: $toolUseId, toolInput: $toolInput, toolInputSize: $toolInputSize}')
    ;;

  "PermissionRequest")
    # Permission dialog shown to user — track what needed approval
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
    TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
    PERMISSION_SUGGESTIONS=$(echo "$INPUT" | jq -c '.permission_suggestions // []')
    TOOL_INPUT_TRUNCATED=$(echo "$TOOL_INPUT" | head -c 4096)
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "permission_request" \
      --arg toolName "$TOOL_NAME" \
      --arg toolInput "$TOOL_INPUT_TRUNCATED" \
      --argjson permissionSuggestions "$PERMISSION_SUGGESTIONS" \
      '. + {type: $type, toolName: $toolName, toolInput: $toolInput, permissionSuggestions: $permissionSuggestions}')
    ;;

  "Notification")
    # Claude sent a notification
    NOTIF_MESSAGE=$(echo "$INPUT" | jq -r '.message // empty')
    NOTIF_TITLE=$(echo "$INPUT" | jq -r '.title // empty')
    NOTIF_TYPE=$(echo "$INPUT" | jq -r '.notification_type // empty')
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "notification" \
      --arg notificationMessage "$NOTIF_MESSAGE" \
      --arg notificationTitle "$NOTIF_TITLE" \
      --arg notificationType "$NOTIF_TYPE" \
      '. + {type: $type, notificationMessage: $notificationMessage, notificationTitle: $notificationTitle, notificationType: $notificationType}')
    ;;

  "SubagentStart")
    # Subagent spawned via Task tool
    AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')
    AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "subagent_start" \
      --arg agentId "$AGENT_ID" \
      --arg agentType "$AGENT_TYPE" \
      '. + {type: $type, agentId: $agentId, agentType: $agentType}')
    ;;

  "SubagentStop")
    # Subagent finished
    AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')
    AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
    TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.agent_transcript_path // empty')
    STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "subagent_stop" \
      --arg agentId "$AGENT_ID" \
      --arg agentType "$AGENT_TYPE" \
      --arg transcriptPath "$TRANSCRIPT_PATH" \
      --argjson stopHookActive "$STOP_HOOK_ACTIVE" \
      '. + {type: $type, agentId: $agentId, agentType: $agentType, transcriptPath: $transcriptPath, stopHookActive: $stopHookActive}')
    ;;

  "TeammateIdle")
    # Team teammate going idle
    TEAMMATE_NAME=$(echo "$INPUT" | jq -r '.teammate_name // empty')
    TEAM_NAME=$(echo "$INPUT" | jq -r '.team_name // empty')
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "teammate_idle" \
      --arg teammateName "$TEAMMATE_NAME" \
      --arg teamName "$TEAM_NAME" \
      '. + {type: $type, teammateName: $teammateName, teamName: $teamName}')
    ;;

  "TaskCompleted")
    # Task marked as completed
    TASK_ID=$(echo "$INPUT" | jq -r '.task_id // empty')
    TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject // empty')
    TASK_DESC=$(echo "$INPUT" | jq -r '.task_description // empty' | head -c 2048)
    TEAMMATE_NAME=$(echo "$INPUT" | jq -r '.teammate_name // empty')
    TEAM_NAME=$(echo "$INPUT" | jq -r '.team_name // empty')
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "task_completed" \
      --arg taskId "$TASK_ID" \
      --arg taskSubject "$TASK_SUBJECT" \
      --arg taskDescription "$TASK_DESC" \
      --arg teammateName "$TEAMMATE_NAME" \
      --arg teamName "$TEAM_NAME" \
      '. + {type: $type, taskId: $taskId, taskSubject: $taskSubject, taskDescription: $taskDescription, teammateName: $teammateName, teamName: $teamName}')
    ;;

  *)
    # Unknown hook — still send it so we capture any new hooks Claude adds
    EVENT=$(echo "$BASE_JSON" | jq \
      --arg type "unknown" \
      --arg hookEvent "$HOOK_EVENT" \
      --arg rawInput "$(echo "$INPUT" | head -c 4096)" \
      '. + {type: $type, hookEvent: $hookEvent, rawInput: $rawInput}')
    ;;
esac

# ============================================================================
# WRITE TO BUFFER FILE
# ============================================================================

# Generate unique filename: timestamp-random.json
TIMESTAMP=$(date +%s%N 2>/dev/null || date +%s)
RANDOM_SUFFIX=$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')
BUFFER_FILE="$BUFFER_DIR/${TIMESTAMP}-${RANDOM_SUFFIX}.json"

echo "$EVENT" > "$BUFFER_FILE"

# Append to event log for local monitor (JSONL — one compact JSON per line, append-only)
EVENTS_LOG="$CONFIG_DIR/events.log"
echo "$EVENT" | jq -c >> "$EVENTS_LOG"

log_debug "Event type: $HOOK_EVENT -> $BUFFER_FILE"

# ============================================================================
# TRIGGER FLUSH
# ============================================================================

if [ "$HOOK_EVENT" == "SessionEnd" ] || [ "$HOOK_EVENT" == "Stop" ]; then
  # Force flush on session end (synchronous)
  if [ -f "$FLUSH_SCRIPT" ]; then
    node "$FLUSH_SCRIPT" --force 2>/dev/null
  fi
else
  # Async flush attempt (non-blocking)
  if [ -f "$FLUSH_SCRIPT" ]; then
    node "$FLUSH_SCRIPT" 2>/dev/null &
  fi
fi

exit 0
