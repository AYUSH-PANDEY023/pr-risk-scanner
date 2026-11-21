import { describe, expect, it } from 'vitest';
import { formatMarkdownReport, formatReport, formatSarifReport } from '../src/reporter.js';
import { buildScanReport } from '../src/scoring.js';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

describe('reporter', () => {
  const sampleReport = buildScanReport({
    branch: 'feat/auth-refresh',
    baseRef: 'main',
    diffMetrics: {
      sourceFiles: [
        { path: 'src/auth/refresh.ts', insertions: 90, deletions: 10, binary: false, status: 'modified' },
      ],
      testFiles: [],
      deletedTestFiles: [],
      ignoredFiles: [],
      criticalMatches: [{ file: 'src/auth/refresh.ts', matchedPattern: '/auth', churn: 100 }],
      configChanges: [],
      totalFilesChanged: 1,
      totalLinesChanged: 100,
      missingTests: true,
    },
    largeFunctions: [
      { file: 'src/auth/refresh.ts', name: 'rotateToken', line: 14, endLine: 78, lineCount: 65 },
    ],
    riskyPatterns: [
      {
        file: 'src/auth/refresh.ts',
        line: 32,
        rule: 'empty-catch',
        severity: 'medium',
        message: 'Empty catch block swallows errors without logging or handling',
        evidence: 'Catch clause body contains 0 executable statements',
      },
    ],
    suppressed: [
      {
        ruleId: 'unsafe-eval',
        location: 'src/auth/refresh.ts:45',
        message: 'eval call',
        source: 'inline',
        reason: 'Legacy expression compatibility',
      },
    ],
    duplicates: [],
    maxFunctionLines: 50,
  });

  it('renders a colored terminal table with branch info, top risks, and suppressed findings', () => {
    const plain = formatReport(sampleReport).replace(ANSI_RE, '');

    expect(plain).toContain('pr-risk-scanner');
    expect(plain).toContain('feat/auth-refresh → main');
    expect(plain).toContain('src/auth/refresh.ts:14');
    expect(plain).toContain('Suppressed Findings (1)');
    expect(plain).toContain('Legacy expression compatibility');
    expect(plain).toContain('Suggested Human Review Focus');
  });

  it('renders GitHub-flavored Markdown for PR comments including suppressed findings', () => {
    const md = formatMarkdownReport(sampleReport);

    expect(md).toContain('## PR Risk Report —');
    expect(md).toContain('| Signal | Observed | Points | Status |');
    expect(md).toContain('<details>');
    expect(md).toContain('`src/auth/refresh.ts:32`');
    expect(md).toContain('Suppressed Findings (1)');
    expect(md).toContain('not a bug probability estimate');
  });

  it('renders valid SARIF v2.1.0 JSON for GitHub Code Scanning', () => {
    const parsed = JSON.parse(formatSarifReport(sampleReport)) as {
      version: string;
      runs: Array<{
        tool: { driver: { name: string; rules: Array<{ id: string }> } };
        results: Array<{ ruleId: string; level: string }>;
      }>;
    };

    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0]?.tool.driver.name).toBe('pr-risk-scanner');
    expect(parsed.runs[0]?.results.some((r) => r.ruleId === 'empty-catch')).toBe(true);
    expect(parsed.runs[0]?.tool.driver.rules.length).toBeGreaterThan(0);
  });
});
