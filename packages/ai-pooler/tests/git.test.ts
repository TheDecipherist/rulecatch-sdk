import { describe, it, expect } from 'vitest';
import {
  isGitRepo,
  getGitRoot,
  collectGitContext,
  getGitSummary,
  type GitContext,
} from '../src/git.js';

describe('git', () => {
  describe('isGitRepo', () => {
    it('returns true in the current working directory (we are in a git repo)', () => {
      const result = isGitRepo();
      expect(result).toBe(true);
    });

    it('returns false for non-git directory', () => {
      // /tmp is typically not a git repo
      const result = isGitRepo('/tmp');
      expect(result).toBe(false);
    });
  });

  describe('getGitRoot', () => {
    it('returns a non-null string for the current repo', () => {
      const root = getGitRoot();

      expect(root).not.toBeNull();
      expect(typeof root).toBe('string');
      expect(root!.length).toBeGreaterThan(0);
    });

    it('returns path ending with rulecatch (the repo name)', () => {
      const root = getGitRoot();

      expect(root).toContain('rulecatch');
    });

    it('returns null for non-git directory', () => {
      const root = getGitRoot('/tmp');
      expect(root).toBeNull();
    });
  });

  describe('collectGitContext', () => {
    it('returns object with branch, commit, repoName for current repo', () => {
      const context = collectGitContext();

      expect(context).toBeDefined();
      expect(typeof context).toBe('object');

      // These should exist since we're in a git repo
      expect(context.branch).toBeDefined();
      expect(typeof context.branch).toBe('string');

      expect(context.commit).toBeDefined();
      expect(typeof context.commit).toBe('string');

      // Repo name should be extracted from remote URL
      expect(context.repoName).toBeDefined();
      expect(typeof context.repoName).toBe('string');
    });

    it('returns isDirty as boolean', () => {
      const context = collectGitContext();

      expect(context.isDirty).toBeDefined();
      expect(typeof context.isDirty).toBe('boolean');
    });

    it('includes username and email from git config', () => {
      const context = collectGitContext();

      // These come from git config, should be set
      expect(context.username).toBeDefined();
      expect(typeof context.username).toBe('string');

      expect(context.email).toBeDefined();
      expect(typeof context.email).toBe('string');
    });

    it('includes rootDir', () => {
      const context = collectGitContext();

      expect(context.rootDir).toBeDefined();
      expect(typeof context.rootDir).toBe('string');
      expect(context.rootDir).toContain('rulecatch');
    });

    it('includes commit information', () => {
      const context = collectGitContext();

      expect(context.commit).toBeDefined(); // Short hash
      expect(context.commitFull).toBeDefined(); // Full hash
      expect(context.commitMessage).toBeDefined();
      expect(context.commitAuthor).toBeDefined();
      expect(context.commitTimestamp).toBeDefined();

      // Short commit should be 7 chars
      expect(context.commit!.length).toBe(7);

      // Full commit should be 40 chars (SHA-1)
      expect(context.commitFull!.length).toBe(40);
    });

    it('includes uncommittedFiles count when dirty', () => {
      const context = collectGitContext();

      if (context.isDirty) {
        expect(context.uncommittedFiles).toBeDefined();
        expect(typeof context.uncommittedFiles).toBe('number');
        expect(context.uncommittedFiles!).toBeGreaterThan(0);
      } else {
        // Clean repo should have 0 or undefined
        if (context.uncommittedFiles !== undefined) {
          expect(context.uncommittedFiles).toBe(0);
        }
      }
    });

    it('returns empty object for non-git directory', () => {
      const context = collectGitContext('/tmp');

      // Should return empty object when not in a git repo
      expect(Object.keys(context).length).toBe(0);
    });

    it('extracts repoName from remote URL', () => {
      const context = collectGitContext();

      expect(context.repoName).toBeDefined();
      // Should be in format "user/repo" or "org/repo"
      expect(context.repoName).toContain('/');
      expect(context.repoName).toContain('rulecatch');
    });
  });

  describe('getGitSummary', () => {
    it('formats context correctly for current repo', () => {
      const context = collectGitContext();
      const summary = getGitSummary(context);

      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);

      // Should contain repo name
      expect(summary).toContain('rulecatch');

      // Should contain branch indicator (@)
      expect(summary).toContain('@');

      // Should contain commit in parentheses
      expect(summary).toMatch(/\([a-f0-9]{7}/);
    });

    it('returns "unknown" for empty context', () => {
      const emptyContext: GitContext = {};
      const summary = getGitSummary(emptyContext);

      expect(summary).toBe('unknown');
    });

    it('includes dirty indicator (*) when isDirty is true', () => {
      const dirtyContext: GitContext = {
        repoName: 'user/repo',
        branch: 'main',
        commit: 'abc1234',
        isDirty: true,
      };

      const summary = getGitSummary(dirtyContext);

      expect(summary).toContain('*');
      expect(summary).toContain('abc1234*');
    });

    it('does not include dirty indicator when isDirty is false', () => {
      const cleanContext: GitContext = {
        repoName: 'user/repo',
        branch: 'main',
        commit: 'abc1234',
        isDirty: false,
      };

      const summary = getGitSummary(cleanContext);

      // Should NOT have asterisk
      expect(summary).not.toMatch(/\*\)/);
      expect(summary).toContain('(abc1234)');
    });

    it('handles partial context (only repoName)', () => {
      const context: GitContext = {
        repoName: 'user/repo',
      };

      const summary = getGitSummary(context);

      expect(summary).toBe('user/repo');
    });

    it('handles partial context (repoName + branch)', () => {
      const context: GitContext = {
        repoName: 'user/repo',
        branch: 'feature-branch',
      };

      const summary = getGitSummary(context);

      expect(summary).toBe('user/repo @feature-branch');
    });

    it('formats full context with all parts', () => {
      const context: GitContext = {
        repoName: 'TheDecipherist/rulecatch',
        branch: 'main',
        commit: 'abc1234',
        isDirty: false,
      };

      const summary = getGitSummary(context);

      expect(summary).toBe('TheDecipherist/rulecatch @main (abc1234)');
    });

    it('formats full dirty context', () => {
      const context: GitContext = {
        repoName: 'TheDecipherist/rulecatch',
        branch: 'feature',
        commit: 'xyz9876',
        isDirty: true,
      };

      const summary = getGitSummary(context);

      expect(summary).toBe('TheDecipherist/rulecatch @feature (xyz9876*)');
    });

    it('handles missing branch but has commit', () => {
      const context: GitContext = {
        repoName: 'user/repo',
        commit: 'abc1234',
        isDirty: false,
      };

      const summary = getGitSummary(context);

      expect(summary).toBe('user/repo (abc1234)');
    });
  });
});
