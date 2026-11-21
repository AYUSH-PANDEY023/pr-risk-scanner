import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS } from '../src/config.js';
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

  it('respects custom signal weights and scores risky patterns', () => {
    const report = buildScanReport({
      branch: 'feat/eval',
      baseRef: 'main',
      diffMetrics: emptyMetrics({ totalFilesChanged: 1, totalLinesChanged: 10 }),
      largeFunctions: [],
      riskyPatterns: [
        {
          file: 'src/run.ts',
          line: 12,
          rule: 'unsafe-eval',
          severity: 'high',
          message: 'Direct eval() call',
        },
        {
          file: 'src/run.ts',
          line: 18,
          rule: 'unsafe-exec',
          severity: 'high',
          message: 'exec() shell call',
        },
        {
          file: 'src/run.ts',
          line: 24,
          rule: 'empty-catch',
          severity: 'medium',
          message: 'Empty catch block',
        },
      ],
      duplicates: [],
      maxFunctionLines: 50,
      weights: { ...DEFAULT_WEIGHTS, riskyPatterns: 30 },
    });

    const signal = report.signals.find((s) => s.key === 'riskyPatterns');
    expect(signal?.maxPoints).toBe(30);
    expect(signal?.points).toBe(30);
    expect(report.metrics.riskyPatterns).toBe(3);
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
      riskyPatterns: [
        { file: 'src/payments/checkout.ts', line: 44, rule: 'empty-catch', severity: 'medium', message: 'Empty catch block' },
        { file: 'src/auth/session.ts', line: 19, rule: 'unsafe-eval', severity: 'high', message: 'Direct eval() call' },
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
