/**
 * Git Context Collection
 *
 * Automatically collects git information from the current repository.
 * This provides context about the development environment to track
 * which project/branch/commit is being worked on.
 */

import { execSync } from 'child_process';
import type { GitContext } from './types.js';

// Re-export the type for convenience
export type { GitContext } from './types.js';

/**
 * Execute a git command and return the output
 */
function execGit(args: string, cwd?: string): string | null {
  try {
    const result = execSync(`git ${args}`, {
      encoding: 'utf-8',
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Check if we're in a git repository
 */
export function isGitRepo(cwd?: string): boolean {
  return execGit('rev-parse --is-inside-work-tree', cwd) === 'true';
}

/**
 * Get the root directory of the git repository
 */
export function getGitRoot(cwd?: string): string | null {
  return execGit('rev-parse --show-toplevel', cwd);
}

/**
 * Collect git context from the current directory
 */
export function collectGitContext(cwd?: string): GitContext {
  const context: GitContext = {};

  if (!isGitRepo(cwd)) {
    return context;
  }

  // Root directory
  context.rootDir = getGitRoot(cwd) || undefined;

  // User info
  context.username = execGit('config user.name', cwd) || undefined;
  context.email = execGit('config user.email', cwd) || undefined;

  // Repository URL
  const remoteUrl = execGit('config --get remote.origin.url', cwd);
  if (remoteUrl) {
    context.repoUrl = remoteUrl;
    context.repoName = extractRepoName(remoteUrl);
  }

  // Branch
  context.branch = execGit('rev-parse --abbrev-ref HEAD', cwd) || undefined;

  // Commit info
  context.commit = execGit('rev-parse --short HEAD', cwd) || undefined;
  context.commitFull = execGit('rev-parse HEAD', cwd) || undefined;
  context.commitMessage = execGit('log -1 --format=%s', cwd) || undefined;
  context.commitAuthor = execGit('log -1 --format=%an', cwd) || undefined;
  context.commitTimestamp = execGit('log -1 --format=%cI', cwd) || undefined;

  // Dirty state
  const status = execGit('status --porcelain', cwd);
  if (status !== null) {
    const files = status.split('\n').filter(line => line.trim().length > 0);
    context.isDirty = files.length > 0;
    context.uncommittedFiles = files.length;
  }

  return context;
}

/**
 * Extract repository name from git URL
 */
function extractRepoName(url: string): string | undefined {
  // Handle SSH URLs: git@github.com:user/repo.git
  const sshMatch = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  // Handle HTTPS URLs: https://github.com/user/repo.git
  const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return httpsMatch[1];
  }

  return undefined;
}

/**
 * Watch for git changes (branch switches, commits, etc.)
 * Returns a cleanup function to stop watching
 */
export function watchGitChanges(
  callback: (context: GitContext) => void,
  options?: {
    cwd?: string;
    pollInterval?: number;
  }
): () => void {
  const cwd = options?.cwd;
  const pollInterval = options?.pollInterval || 5000;

  let lastCommit: string | undefined;
  let lastBranch: string | undefined;

  const check = () => {
    if (!isGitRepo(cwd)) return;

    const currentCommit = execGit('rev-parse HEAD', cwd) || undefined;
    const currentBranch = execGit('rev-parse --abbrev-ref HEAD', cwd) || undefined;

    // Only trigger callback if something changed
    if (currentCommit !== lastCommit || currentBranch !== lastBranch) {
      lastCommit = currentCommit;
      lastBranch = currentBranch;
      callback(collectGitContext(cwd));
    }
  };

  // Initial check
  check();

  // Poll for changes
  const intervalId = setInterval(check, pollInterval);

  // Return cleanup function
  return () => {
    clearInterval(intervalId);
  };
}

/**
 * Get a summary string for the current git context
 */
export function getGitSummary(context: GitContext): string {
  const parts: string[] = [];

  if (context.repoName) {
    parts.push(context.repoName);
  }

  if (context.branch) {
    parts.push(`@${context.branch}`);
  }

  if (context.commit) {
    parts.push(`(${context.commit}${context.isDirty ? '*' : ''})`);
  }

  return parts.join(' ') || 'unknown';
}
