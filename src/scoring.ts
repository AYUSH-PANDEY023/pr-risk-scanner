import type {
  DiffMetricsResult,
  DuplicateBlockFinding,
  LargeFunctionFinding,
  ReviewFocus,
  RiskItem,
  ScanReport,
  Severity,
  SignalScore,
} from './types.js';

export interface ScoreInput {
  branch: string;
  baseRef: string;
  diffMetrics: DiffMetricsResult;
  largeFunctions: LargeFunctionFinding[];
  duplicates: DuplicateBlockFinding[];
  maxFunctionLines: number;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function scoreToLevel(score: number): Severity {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function ratioToSeverity(points: number, maxPoints: number): Severity {
  if (points === 0) return 'low';
  const ratio = points / maxPoints;
  if (ratio >= 0.85) return 'critical';
  if (ratio >= 0.6) return 'high';
  if (ratio >= 0.3) return 'medium';
  return 'low';
}

function scoreFilesChanged(count: number): number {
  if (count <= 3) return 0;
  if (count <= 7) return 4;
  if (count <= 14) return 8;
  if (count <= 24) return 12;
  return 15;
}

function scoreLinesChanged(lines: number): number {
  if (lines <= 100) return 0;
  if (lines <= 250) return 5;
  if (lines <= 500) return 10;
  if (lines <= 900) return 15;
  return 20;
}

function scoreMissingTests(diffMetrics: DiffMetricsResult): number {
  if (!diffMetrics.missingTests) return 0;
  return diffMetrics.totalLinesChanged > 150 ? 15 : 10;
}

function scoreCriticalPaths(matches: DiffMetricsResult['criticalMatches']): number {
  if (matches.length === 0) return 0;
  const totalChurn = matches.reduce((sum, m) => sum + m.churn, 0);
  const base = 12 + (matches.length - 1) * 5;
  const churnBonus = totalChurn >= 120 ? 4 : 0;
  return Math.min(25, base + churnBonus);
}

function scoreDuplicates(duplicates: DuplicateBlockFinding[]): number {
  if (duplicates.length === 0) return 0;
  const totalDupLines = duplicates.reduce((sum, d) => sum + d.lines, 0);
  const raw = duplicates.length * 4 + (totalDupLines >= 40 ? 2 : 0);
  return Math.min(10, raw);
}

function scoreLargeFunctions(findings: LargeFunctionFinding[]): number {
  if (findings.length === 0) return 0;
  const largest = findings[0]?.lineCount ?? 0;
  const raw = findings.length * 4 + (largest >= 100 ? 4 : 0);
  return Math.min(15, raw);
}

export function buildScanReport(input: ScoreInput): ScanReport {
  const { diffMetrics, largeFunctions, duplicates, maxFunctionLines } = input;

  const filesPts = scoreFilesChanged(diffMetrics.totalFilesChanged);
  const linesPts = scoreLinesChanged(diffMetrics.totalLinesChanged);
  const testsPts = scoreMissingTests(diffMetrics);
  const criticalPts = scoreCriticalPaths(diffMetrics.criticalMatches);
  const dupPts = scoreDuplicates(duplicates);
  const fnPts = scoreLargeFunctions(largeFunctions);

  const signals: SignalScore[] = [
    {
      key: 'filesChanged',
      label: 'Files changed',
      observed: `${diffMetrics.totalFilesChanged} file${diffMetrics.totalFilesChanged === 1 ? '' : 's'}`,
      points: filesPts,
      maxPoints: 15,
      severity: ratioToSeverity(filesPts, 15),
    },
    {
      key: 'linesChanged',
      label: 'Lines changed',
      observed: `${diffMetrics.totalLinesChanged} lines`,
      points: linesPts,
      maxPoints: 20,
      severity: ratioToSeverity(linesPts, 20),
    },
    {
      key: 'missingTests',
      label: 'Test coverage delta',
      observed: diffMetrics.missingTests
        ? '0 test files updated'
        : `${diffMetrics.testFiles.length} test file${diffMetrics.testFiles.length === 1 ? '' : 's'}`,
      points: testsPts,
      maxPoints: 15,
      severity: ratioToSeverity(testsPts, 15),
    },
    {
      key: 'criticalPaths',
      label: 'Critical paths',
      observed:
        diffMetrics.criticalMatches.length > 0
          ? `${diffMetrics.criticalMatches.length} sensitive file${diffMetrics.criticalMatches.length === 1 ? '' : 's'}`
          : 'none',
      points: criticalPts,
      maxPoints: 25,
      severity: ratioToSeverity(criticalPts, 25),
    },
    {
      key: 'duplicateCode',
      label: 'Duplicate code (jscpd)',
      observed:
        duplicates.length > 0
          ? `${duplicates.length} block${duplicates.length === 1 ? '' : 's'}`
          : 'none',
      points: dupPts,
      maxPoints: 10,
      severity: ratioToSeverity(dupPts, 10),
    },
    {
      key: 'largeFunctions',
      label: `Large functions (>${maxFunctionLines}L)`,
      observed:
        largeFunctions.length > 0
          ? `${largeFunctions.length} function${largeFunctions.length === 1 ? '' : 's'}`
          : 'none',
      points: fnPts,
      maxPoints: 15,
      severity: ratioToSeverity(fnPts, 15),
    },
  ];

  const rawTotal = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.min(100, Math.max(0, rawTotal));
  const level = scoreToLevel(score);

  const topRisks: RiskItem[] = [];

  for (const match of diffMetrics.criticalMatches) {
    topRisks.push({
      severity: match.churn >= 80 ? 'critical' : 'high',
      category: 'criticalPaths',
      location: match.file,
      message: `Touched critical path (${match.matchedPattern}) with ${match.churn} lines changed`,
    });
  }

  if (diffMetrics.missingTests) {
    topRisks.push({
      severity: diffMetrics.totalLinesChanged > 150 ? 'high' : 'medium',
      category: 'missingTests',
      location: '(branch diff)',
      message: `${diffMetrics.sourceFiles.length} source file(s) changed with no matching test updates`,
    });
  }

  for (const fn of largeFunctions.slice(0, 8)) {
    topRisks.push({
      severity: fn.lineCount >= 100 ? 'high' : 'medium',
      category: 'largeFunctions',
      location: `${fn.file}:${fn.line}`,
      message: `${fn.name} is ${fn.lineCount} lines long (limit ${maxFunctionLines})`,
    });
  }

  for (const dup of duplicates.slice(0, 6)) {
    topRisks.push({
      severity: dup.lines >= 25 ? 'high' : 'medium',
      category: 'duplicateCode',
      location: `${dup.fileA}:${dup.startLineA}-${dup.endLineA}`,
      message: `${dup.lines} duplicated lines also found in ${dup.fileB}:${dup.startLineB}-${dup.endLineB}`,
    });
  }

  if (diffMetrics.totalLinesChanged > 500) {
    topRisks.push({
      severity: diffMetrics.totalLinesChanged > 900 ? 'high' : 'medium',
      category: 'linesChanged',
      location: '(branch diff)',
      message: `Large PR diff (${diffMetrics.totalLinesChanged} lines across ${diffMetrics.totalFilesChanged} files) increases reviewer fatigue`,
    });
  }

  topRisks.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const reviewFocus = buildReviewFocus(diffMetrics, largeFunctions, duplicates);

  return {
    branch: input.branch,
    baseRef: input.baseRef,
    score,
    level,
    signals,
    topRisks: topRisks.slice(0, 12),
    reviewFocus,
    metrics: {
      filesChanged: diffMetrics.totalFilesChanged,
      linesChanged: diffMetrics.totalLinesChanged,
      testFilesChanged: diffMetrics.testFiles.length,
      criticalFilesTouched: diffMetrics.criticalMatches.length,
      duplicateBlocks: duplicates.length,
      largeFunctions: largeFunctions.length,
    },
  };
}

function buildReviewFocus(
  diffMetrics: DiffMetricsResult,
  largeFunctions: LargeFunctionFinding[],
  duplicates: DuplicateBlockFinding[],
): ReviewFocus[] {
  const focus: ReviewFocus[] = [];

  const authFiles = diffMetrics.criticalMatches.filter((m) =>
    m.matchedPattern.toLowerCase().includes('auth'),
  );
  const paymentFiles = diffMetrics.criticalMatches.filter((m) =>
    m.matchedPattern.toLowerCase().includes('payment'),
  );
  const migrationFiles = diffMetrics.criticalMatches.filter((m) =>
    m.matchedPattern.toLowerCase().includes('migration'),
  );
  const otherCritical = diffMetrics.criticalMatches.filter(
    (m) =>
      !authFiles.includes(m) &&
      !paymentFiles.includes(m) &&
      !migrationFiles.includes(m),
  );

  if (authFiles.length > 0) {
    focus.push({
      priority: 'P1',
      area: 'Auth & access control',
      detail: `Audit token validation, session expiry, and role checks in ${authFiles.map((f) => f.file).slice(0, 3).join(', ')}.`,
    });
  }

  if (paymentFiles.length > 0) {
    focus.push({
      priority: 'P1',
      area: 'Payments & idempotency',
      detail: `Verify idempotency keys, webhook signature checks, and rounding/currency handling in ${paymentFiles.map((f) => f.file).slice(0, 3).join(', ')}.`,
    });
  }

  if (migrationFiles.length > 0) {
    focus.push({
      priority: 'P1',
      area: 'Schema migrations',
      detail: `Check backward compatibility, lock duration on large tables, and rollback path for ${migrationFiles.map((f) => f.file).slice(0, 3).join(', ')}.`,
    });
  }

  if (otherCritical.length > 0) {
    focus.push({
      priority: 'P1',
      area: 'Sensitive modules',
      detail: `Do a line-by-line review of ${otherCritical.map((f) => f.file).slice(0, 3).join(', ')}.`,
    });
  }

  if (diffMetrics.missingTests) {
    const heaviest = [...diffMetrics.sourceFiles]
      .sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions))
      .slice(0, 2)
      .map((f) => f.path);

    focus.push({
      priority: 'P1',
      area: 'Missing test coverage',
      detail: `Request unit/integration tests covering failure branches in ${heaviest.join(', ')}.`,
    });
  }

  if (largeFunctions.length > 0) {
    const topFn = largeFunctions[0]!;
    focus.push({
      priority: 'P2',
      area: 'Complex functions',
      detail: `Walk through control flow and error handling in ${topFn.name} (${topFn.file}:${topFn.line}, ${topFn.lineCount} lines) and consider extracting helpers.`,
    });
  }

  if (duplicates.length > 0) {
    const topDup = duplicates[0]!;
    focus.push({
      priority: 'P2',
      area: 'Copy-paste duplication',
      detail: `Check if shared logic between ${topDup.fileA}:${topDup.startLineA} and ${topDup.fileB}:${topDup.startLineB} should be consolidated to avoid drift.`,
    });
  }

  if (diffMetrics.totalLinesChanged > 500 || diffMetrics.totalFilesChanged > 14) {
    focus.push({
      priority: 'P3',
      area: 'PR scope',
      detail: `Diff spans ${diffMetrics.totalFilesChanged} files / ${diffMetrics.totalLinesChanged} lines — consider splitting refactors from behavior changes.`,
    });
  }

  if (focus.length === 0) {
    focus.push({
      priority: 'P3',
      area: 'Standard review',
      detail: 'No elevated risk signals detected. Focus on naming clarity and business-logic edge cases.',
    });
  }

  return focus;
}
