import { describe, expect, it } from 'vitest';
import { buildScanReport, scoreToLevel } from '../src/scoring.js';
import type { DiffMetricsResult } from '../src/types.js';

function emptyMetrics(overrides: Partial<DiffMetricsResult> = {}): DiffMetricsResult {
  return {
    sourceFiles: [],
    testFiles: [],
    ignoredFiles: [],
    criticalMatches: [],
    totalFilesChanged: 0,
    totalLinesChanged: 0,
    missingTests: false,
    ...overrides,
  };
}

describe('scoring', () => {
  it('scores a clean small PR as low risk', () => {
    const report = buildScanReport({
      branch: 'fix/typo',
      baseRef: 'main',
      diffMetrics: emptyMetrics({
        sourceFiles: [
          { path: 'src/utils.ts', insertions: 12, deletions: 4, binary: false, status: 'modified' },
        ],
        testFiles: [
          { path: 'tests/utils.test.ts', insertions: 10, deletions: 0, binary: false, status: 'modified' },
        ],
        totalFilesChanged: 2,
        totalLinesChanged: 26,
      }),
      largeFunctions: [],
      duplicates: [],
      maxFunctionLines: 50,
    });

    expect(report.score).toBe(0);
    expect(report.level).toBe('low');
    expect(report.topRisks).toHaveLength(0);
    expect(report.reviewFocus[0]?.priority).toBe('P3');
  });

  it('caps total score at 100 and prioritizes critical paths and missing tests', () => {
    const report = buildScanReport({
      branch: 'feat/billing-rewrite',
      baseRef: 'main',
      diffMetrics: emptyMetrics({
        sourceFiles: Array.from({ length: 26 }, (_, i) => ({
          path: `src/payments/mod${i}.ts`,
          insertions: 40,
          deletions: 10,
          binary: false,
          status: 'modified' as const,
        })),
        criticalMatches: [
          { file: 'src/payments/checkout.ts', matchedPattern: '/payments', churn: 180 },
          { file: 'src/auth/session.ts', matchedPattern: '/auth', churn: 95 },
          { file: 'db/migrations/012_billing.sql', matchedPattern: '/migrations', churn: 40 },
        ],
        totalFilesChanged: 26,
        totalLinesChanged: 1300,
        missingTests: true,
      }),
      largeFunctions: [
        { file: 'src/payments/checkout.ts', name: 'runCheckout', line: 22, endLine: 145, lineCount: 124 },
        { file: 'src/auth/session.ts', name: 'verifyToken', line: 10, endLine: 82, lineCount: 73 },
      ],
      duplicates: [
        {
          fileA: 'src/payments/checkout.ts',
          startLineA: 30,
          endLineA: 60,
          fileB: 'src/payments/refund.ts',
          startLineB: 15,
          endLineB: 45,
          lines: 31,
          tokens: 180,
        },
        {
          fileA: 'src/payments/mod1.ts',
          startLineA: 1,
          endLineA: 20,
          fileB: 'src/payments/mod2.ts',
          startLineB: 1,
          endLineB: 20,
          lines: 20,
          tokens: 120,
        },
      ],
      maxFunctionLines: 50,
    });

    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.score).toBeGreaterThanOrEqual(80);
    expect(report.level).toBe('critical');
    expect(report.reviewFocus.some((f) => f.area.includes('Auth'))).toBe(true);
    expect(report.reviewFocus.some((f) => f.area.includes('Payments'))).toBe(true);
    expect(report.reviewFocus.some((f) => f.area.includes('migrations'))).toBe(true);
  });

  it('maps score bands accurately', () => {
    expect(scoreToLevel(0)).toBe('low');
    expect(scoreToLevel(29)).toBe('low');
    expect(scoreToLevel(30)).toBe('medium');
    expect(scoreToLevel(60)).toBe('high');
    expect(scoreToLevel(80)).toBe('critical');
  });
});
