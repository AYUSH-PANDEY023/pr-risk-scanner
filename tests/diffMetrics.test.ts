import { describe, expect, it } from 'vitest';
import {
  analyzeDiffMetrics,
  classifyConfigChange,
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

  it('ignores lockfiles, build directories, and extension wildcards', () => {
    expect(isIgnoredFile('package-lock.json', DEFAULT_CONFIG.ignoreFiles)).toBe(true);
    expect(isIgnoredFile('packages/web/dist/bundle.js', DEFAULT_CONFIG.ignoreFiles)).toBe(true);
    expect(isIgnoredFile('src/generated.d.ts', ['*.d.ts'])).toBe(true);
    expect(isIgnoredFile('src/index.ts', DEFAULT_CONFIG.ignoreFiles)).toBe(false);
  });

  it('recognizes common test file conventions and classifies config/dependency changes', () => {
    expect(isTestFile('src/auth/jwt.test.ts', DEFAULT_CONFIG.testPatterns)).toBe(true);
    expect(isTestFile('src/utils/calc.spec.js', DEFAULT_CONFIG.testPatterns)).toBe(true);
    expect(isTestFile('tests/e2e/login.ts', DEFAULT_CONFIG.testPatterns)).toBe(true);
    expect(isTestFile('src/auth/jwt.ts', DEFAULT_CONFIG.testPatterns)).toBe(false);

    expect(classifyConfigChange('package.json')).toBe('dependency-manifest');
    expect(classifyConfigChange('package-lock.json')).toBe('lockfile');
    expect(classifyConfigChange('.github/workflows/deploy.yml')).toBe('ci-workflow');
    expect(classifyConfigChange('.env.example')).toBe('env-template');
    expect(classifyConfigChange('tsconfig.json')).toBe('runtime-config');
  });

  it('detects deleted test files and tracks config changes while ignoring lockfile line bloat', () => {
    const result = analyzeDiffMetrics(
      [
        makeFile({ path: 'src/payments/checkout.ts', insertions: 45, deletions: 10 }),
        makeFile({ path: 'tests/checkout.test.ts', insertions: 0, deletions: 80, status: 'deleted' }),
        makeFile({ path: 'package-lock.json', insertions: 900, deletions: 400 }),
        makeFile({ path: '.github/workflows/ci.yml', insertions: 12, deletions: 2 }),
      ],
      DEFAULT_CONFIG,
    );

    expect(result.ignoredFiles).toEqual(['package-lock.json']);
    expect(result.deletedTestFiles).toEqual(['tests/checkout.test.ts']);
    expect(result.missingTests).toBe(true);
    expect(result.configChanges.map((c) => c.kind)).toContain('lockfile');
    expect(result.configChanges.map((c) => c.kind)).toContain('ci-workflow');
    expect(result.criticalMatches[0]?.matchedPattern).toBe('/payments');
  });

  it('does not flag missing tests for docs-only, binary, or tiny diffs', () => {
    const docsOnly = analyzeDiffMetrics(
      [
        makeFile({ path: 'README.md', insertions: 80, deletions: 5 }),
        makeFile({ path: 'assets/logo.png', insertions: 0, deletions: 0, binary: true }),
      ],
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
