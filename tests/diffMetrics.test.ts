import { describe, expect, it } from 'vitest';
import {
  analyzeDiffMetrics,
  isIgnoredFile,
  isTestFile,
  matchCriticalPath,
} from '../src/analyzers/diffMetrics.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { ChangedFile } from '../src/types.js';

function makeFile(overrides: Partial<ChangedFile> & { path: string }): ChangedFile {
  return {
    insertions: 10,
    deletions: 2,
    binary: false,
    status: 'modified',
    ...overrides,
  };
}

describe('diffMetrics', () => {
  it('matches critical paths by segment without partial-word false positives', () => {
    expect(matchCriticalPath('src/auth/jwt.ts', DEFAULT_CONFIG.criticalPaths)).toBe('/auth');
    expect(matchCriticalPath('payments/stripe.ts', DEFAULT_CONFIG.criticalPaths)).toBe('/payments');
    expect(matchCriticalPath('db/migrations/004_users.sql', DEFAULT_CONFIG.criticalPaths)).toBe(
      '/migrations',
    );
    expect(matchCriticalPath('src/author/profile.ts', DEFAULT_CONFIG.criticalPaths)).toBeNull();
  });

  it('ignores lockfiles and build directories', () => {
    expect(isIgnoredFile('package-lock.json', DEFAULT_CONFIG.ignoreFiles)).toBe(true);
    expect(isIgnoredFile('packages/web/dist/bundle.js', DEFAULT_CONFIG.ignoreFiles)).toBe(true);
    expect(isIgnoredFile('src/index.ts', DEFAULT_CONFIG.ignoreFiles)).toBe(false);
  });

  it('recognizes common test file conventions', () => {
    expect(isTestFile('src/auth/jwt.test.ts', DEFAULT_CONFIG.testPatterns)).toBe(true);
    expect(isTestFile('src/utils/calc.spec.js', DEFAULT_CONFIG.testPatterns)).toBe(true);
    expect(isTestFile('tests/e2e/login.ts', DEFAULT_CONFIG.testPatterns)).toBe(true);
    expect(isTestFile('src/auth/jwt.ts', DEFAULT_CONFIG.testPatterns)).toBe(false);
  });

  it('flags missing tests when production code churn exceeds threshold', () => {
    const result = analyzeDiffMetrics(
      [
        makeFile({ path: 'src/payments/checkout.ts', insertions: 45, deletions: 10 }),
        makeFile({ path: 'package-lock.json', insertions: 900, deletions: 400 }),
      ],
      DEFAULT_CONFIG,
    );

    expect(result.ignoredFiles).toEqual(['package-lock.json']);
    expect(result.totalFilesChanged).toBe(1);
    expect(result.totalLinesChanged).toBe(55);
    expect(result.missingTests).toBe(true);
    expect(result.criticalMatches).toHaveLength(1);
    expect(result.criticalMatches[0]?.matchedPattern).toBe('/payments');
  });

  it('does not flag missing tests for docs-only or tiny diffs', () => {
    const docsOnly = analyzeDiffMetrics(
      [makeFile({ path: 'README.md', insertions: 80, deletions: 5 })],
      DEFAULT_CONFIG,
    );
    expect(docsOnly.missingTests).toBe(false);

    const tinyFix = analyzeDiffMetrics(
      [makeFile({ path: 'src/app.ts', insertions: 3, deletions: 2 })],
      DEFAULT_CONFIG,
    );
    expect(tinyFix.missingTests).toBe(false);
  });
});
