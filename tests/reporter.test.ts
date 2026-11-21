import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/reporter.js';
import { buildScanReport } from '../src/scoring.js';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

describe('reporter', () => {
  it('renders a table with branch info, top risks, and review focus areas', () => {
    const report = buildScanReport({
      branch: 'feat/auth-refresh',
      baseRef: 'main',
      diffMetrics: {
        sourceFiles: [
          { path: 'src/auth/refresh.ts', insertions: 90, deletions: 10, binary: false, status: 'modified' },
        ],
        testFiles: [],
        ignoredFiles: [],
        criticalMatches: [{ file: 'src/auth/refresh.ts', matchedPattern: '/auth', churn: 100 }],
        totalFilesChanged: 1,
        totalLinesChanged: 100,
        missingTests: true,
      },
      largeFunctions: [
        { file: 'src/auth/refresh.ts', name: 'rotateToken', line: 14, endLine: 78, lineCount: 65 },
      ],
      duplicates: [],
      maxFunctionLines: 50,
    });

    const plain = formatReport(report).replace(ANSI_RE, '');

    expect(plain).toContain('pr-risk-scanner');
    expect(plain).toContain('feat/auth-refresh → main');
    expect(plain).toContain('src/auth/refresh.ts:14');
    expect(plain).toContain('rotateToken');
    expect(plain).toContain('Suggested Human Review Focus');
    expect(plain).toContain('Auth & access control');
  });
});
