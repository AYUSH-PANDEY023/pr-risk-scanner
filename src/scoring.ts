import { DEFAULT_SEVERITY_THRESHOLDS, DEFAULT_WEIGHTS } from './config.js';
import type {
  ConfigChangeFinding,
  DiffMetricsResult,
  DuplicateBlockFinding,
  LargeFunctionFinding,
  ReviewFocus,
  RiskItem,
  RiskyPatternFinding,
  ScanReport,
  Severity,
  SeverityThresholds,
  SignalScore,
  SignalWeights,
  SuppressedFinding,
} from './types.js';

export const TOOL_VERSION = '1.2.0';

export interface ScoreInput {
  branch: string;
  baseRef: string;
  diffMetrics: DiffMetricsResult;
  largeFunctions: LargeFunctionFinding[];
  riskyPatterns?: RiskyPatternFinding[];
  duplicates: DuplicateBlockFinding[];
  suppressed?: SuppressedFinding[];
  maxFunctionLines: number;
  weights?: SignalWeights;
  severityThresholds?: SeverityThresholds;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function scoreToLevel(
  score: number,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): Severity {
  if (score >= thresholds.critical) return 'critical';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

function ratioToSeverity(points: number, maxPoints: number): Severity {
  if (points === 0 || maxPoints <= 0) return 'low';
  const ratio = points / maxPoints;
  if (ratio >= 0.85) return 'critical';
  if (ratio >= 0.6) return 'high';
  if (ratio >= 0.3) return 'medium';
  return 'low';
}

function scale(ratio: number, maxPoints: number): number {
  if (maxPoints <= 0 || ratio <= 0) return 0;
  return Math.min(maxPoints, Math.round(Math.min(1, ratio) * maxPoints));
}

function filesRatio(count: number): number {
  if (count <= 3) return 0;
  if (count <= 7) return 0.3;
  if (count <= 14) return 0.55;
  if (count <= 24) return 0.8;
  return 1;
}

function linesRatio(lines: number): number {
  if (lines <= 100) return 0;
  if (lines <= 250) return 0.25;
  if (lines <= 500) return 0.5;
  if (lines <= 900) return 0.75;
  return 1;
}

function missingTestsRatio(diffMetrics: DiffMetricsResult): number {
  let ratio = 0;
  if (diffMetrics.missingTests) {
    ratio += diffMetrics.totalLinesChanged > 150 ? 0.85 : 0.65;
  }
  if (diffMetrics.deletedTestFiles.length > 0) {
    ratio += 0.35;
  }
  return Math.min(1, ratio);
}

function criticalPathsRatio(matches: DiffMetricsResult['criticalMatches']): number {
  if (matches.length === 0) return 0;
  const totalChurn = matches.reduce((sum, m) => sum + m.churn, 0);
  const base = 0.5 + (matches.length - 1) * 0.2;
  const churnBonus = totalChurn >= 120 ? 0.15 : 0;
  return Math.min(1, base + churnBonus);
}

function duplicatesRatio(duplicates: DuplicateBlockFinding[]): number {
  if (duplicates.length === 0) return 0;
  const totalDupLines = duplicates.reduce((sum, d) => sum + d.lines, 0);
  return Math.min(1, duplicates.length * 0.4 + (totalDupLines >= 40 ? 0.2 : 0));
}

function largeFunctionsRatio(findings: LargeFunctionFinding[]): number {
  if (findings.length === 0) return 0;
  const largest = findings[0]?.lineCount ?? 0;
  return Math.min(1, findings.length * 0.3 + (largest >= 100 ? 0.25 : 0));
}

function riskyPatternsRatio(findings: RiskyPatternFinding[]): number {
  if (findings.length === 0) return 0;
  const weighted = findings.reduce(
    (sum, item) => sum + (item.severity === 'high' ? 0.45 : 0.25),
    0,
  );
  return Math.min(1, weighted);
}

function configChangesRatio(changes: ConfigChangeFinding[]): number {
  if (changes.length === 0) return 0;
  let score = 0;
  for (const change of changes) {
    if (change.kind === 'ci-workflow' || change.kind === 'env-template') score += 0.55;
    else if (change.kind === 'dependency-manifest' || change.kind === 'runtime-config') score += 0.4;
    else score += 0.2;
  }
  return Math.min(1, score);
}

function distributePoints(total: number, count: number): number {
  if (total <= 0 || count <= 0) return 0;
  return Math.max(1, Math.round(total / count));
}

export function buildScanReport(input: ScoreInput): ScanReport {
  const { diffMetrics, largeFunctions, duplicates, maxFunctionLines } = input;
  const riskyPatterns = input.riskyPatterns ?? [];
  const suppressed = input.suppressed ?? [];
  const w = input.weights ?? DEFAULT_WEIGHTS;
  const thresholds = input.severityThresholds ?? DEFAULT_SEVERITY_THRESHOLDS;

  const missingDependencies = [
    ...new Set(
      riskyPatterns
        .filter((item) => item.rule === 'missing-dependency' && item.packageName)
        .map((item) => item.packageName as string),
    ),
  ].sort();

  const filesPts = scale(filesRatio(diffMetrics.totalFilesChanged), w.filesChanged);
  const linesPts = scale(linesRatio(diffMetrics.totalLinesChanged), w.linesChanged);
  const testsPts = scale(missingTestsRatio(diffMetrics), w.missingTests);
  const criticalPts = scale(criticalPathsRatio(diffMetrics.criticalMatches), w.criticalPaths);
  const dupPts = scale(duplicatesRatio(duplicates), w.duplicateCode);
  const fnPts = scale(largeFunctionsRatio(largeFunctions), w.largeFunctions);
  const riskyPts = scale(riskyPatternsRatio(riskyPatterns), w.riskyPatterns);
  const configPts = scale(configChangesRatio(diffMetrics.configChanges), w.dependencyAndConfig);

  const testObservedParts: string[] = [];
  if (diffMetrics.missingTests) testObservedParts.push('0 test updates');
  else testObservedParts.push(`${diffMetrics.testFiles.length} test file${diffMetrics.testFiles.length === 1 ? '' : 's'}`);
  if (diffMetrics.deletedTestFiles.length > 0) {
    testObservedParts.push(`${diffMetrics.deletedTestFiles.length} deleted`);
  }

  const signals: SignalScore[] = [
    {
      key: 'filesChanged',
      label: 'Files changed',
      observed: `${diffMetrics.totalFilesChanged} file${diffMetrics.totalFilesChanged === 1 ? '' : 's'}`,
      points: filesPts,
      maxPoints: w.filesChanged,
      severity: ratioToSeverity(filesPts, w.filesChanged),
    },
    {
      key: 'linesChanged',
      label: 'Lines changed',
      observed: `${diffMetrics.totalLinesChanged} lines`,
      points: linesPts,
      maxPoints: w.linesChanged,
      severity: ratioToSeverity(linesPts, w.linesChanged),
    },
    {
      key: 'missingTests',
      label: 'Testing signals',
      observed: testObservedParts.join(', '),
      points: testsPts,
      maxPoints: w.missingTests,
      severity: ratioToSeverity(testsPts, w.missingTests),
    },
    {
      key: 'criticalPaths',
      label: 'Critical paths',
      observed:
        diffMetrics.criticalMatches.length > 0
          ? `${diffMetrics.criticalMatches.length} sensitive file${diffMetrics.criticalMatches.length === 1 ? '' : 's'}`
          : 'none',
      points: criticalPts,
      maxPoints: w.criticalPaths,
      severity: ratioToSeverity(criticalPts, w.criticalPaths),
    },
    {
      key: 'duplicateCode',
      label: 'Duplicate code (jscpd)',
      observed:
        duplicates.length > 0
          ? `${duplicates.length} block${duplicates.length === 1 ? '' : 's'}`
          : 'none',
      points: dupPts,
      maxPoints: w.duplicateCode,
      severity: ratioToSeverity(dupPts, w.duplicateCode),
    },
    {
      key: 'largeFunctions',
      label: `Large functions (>${maxFunctionLines}L)`,
      observed:
        largeFunctions.length > 0
          ? `${largeFunctions.length} function${largeFunctions.length === 1 ? '' : 's'}`
          : 'none',
      points: fnPts,
      maxPoints: w.largeFunctions,
      severity: ratioToSeverity(fnPts, w.largeFunctions),
    },
    {
      key: 'riskyPatterns',
      label: 'Complexity & risky patterns',
      observed:
        riskyPatterns.length > 0
          ? `${riskyPatterns.length} indicator${riskyPatterns.length === 1 ? '' : 's'}`
          : 'none',
      points: riskyPts,
      maxPoints: w.riskyPatterns,
      severity: ratioToSeverity(riskyPts, w.riskyPatterns),
    },
    {
      key: 'dependencyAndConfig',
      label: 'Deps & config changes',
      observed:
        diffMetrics.configChanges.length > 0
          ? `${diffMetrics.configChanges.length} file${diffMetrics.configChanges.length === 1 ? '' : 's'}`
          : 'none',
      points: configPts,
      maxPoints: w.dependencyAndConfig,
      severity: ratioToSeverity(configPts, w.dependencyAndConfig),
    },
  ];

  const rawTotal = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.min(100, Math.max(0, rawTotal));
  const level = scoreToLevel(score, thresholds);

  const topRisks: RiskItem[] = [];

  const criticalPerItem = distributePoints(criticalPts, diffMetrics.criticalMatches.length);
  for (const match of diffMetrics.criticalMatches) {
    topRisks.push({
      ruleId: 'critical-path',
      severity: match.churn >= 80 ? 'critical' : 'high',
      category: 'criticalPaths',
      location: match.file,
      file: match.file,
      points: criticalPerItem,
      message: `Touched critical path (${match.matchedPattern}) with ${match.churn} lines changed`,
      evidence: `Matched configured critical segment "${match.matchedPattern}" (${match.churn} lines churn)`,
    });
  }

  const riskyPerItem = distributePoints(riskyPts, riskyPatterns.length);
  for (const issue of riskyPatterns.slice(0, 10)) {
    topRisks.push({
      ruleId: issue.rule,
      severity: issue.severity,
      category: 'riskyPatterns',
      location: `${issue.file}:${issue.line}`,
      file: issue.file,
      line: issue.line,
      points: riskyPerItem,
      message: `[${issue.rule}] ${issue.message}`,
      evidence: issue.evidence,
    });
  }

  for (const deletedTest of diffMetrics.deletedTestFiles) {
    topRisks.push({
      ruleId: 'deleted-test',
      severity: 'high',
      category: 'missingTests',
      location: deletedTest,
      file: deletedTest,
      points: distributePoints(testsPts, diffMetrics.deletedTestFiles.length + (diffMetrics.missingTests ? 1 : 0)),
      message: 'Existing test file was deleted in this diff',
      evidence: `Git status D for test file ${deletedTest}`,
    });
  }

  if (diffMetrics.missingTests) {
    topRisks.push({
      ruleId: 'missing-tests',
      severity: diffMetrics.totalLinesChanged > 150 ? 'high' : 'medium',
      category: 'missingTests',
      location: '(branch diff)',
      points: distributePoints(testsPts, diffMetrics.deletedTestFiles.length + 1),
      message: `${diffMetrics.sourceFiles.length} source file(s) changed with no matching test updates`,
      evidence: `${diffMetrics.totalLinesChanged} changed lines across production files and 0 modified test files`,
    });
  }

  const fnPerItem = distributePoints(fnPts, largeFunctions.length);
  for (const fn of largeFunctions.slice(0, 8)) {
    topRisks.push({
      ruleId: 'large-function',
      severity: fn.lineCount >= 100 ? 'high' : 'medium',
      category: 'largeFunctions',
      location: `${fn.file}:${fn.line}`,
      file: fn.file,
      line: fn.line,
      points: fnPerItem,
      message: `${fn.name} is ${fn.lineCount} lines long (limit ${maxFunctionLines})`,
      evidence: `AST span lines ${fn.line}-${fn.endLine} (${fn.lineCount} lines)`,
    });
  }

  const dupPerItem = distributePoints(dupPts, duplicates.length);
  for (const dup of duplicates.slice(0, 6)) {
    topRisks.push({
      ruleId: 'duplicate-code',
      severity: dup.lines >= 25 ? 'high' : 'medium',
      category: 'duplicateCode',
      location: `${dup.fileA}:${dup.startLineA}-${dup.endLineA}`,
      file: dup.fileA,
      line: dup.startLineA,
      points: dupPerItem,
      message: `${dup.lines} duplicated lines also found in ${dup.fileB}:${dup.startLineB}-${dup.endLineB}`,
      evidence: `jscpd token clone (${dup.lines} lines, ${dup.tokens} tokens)`,
    });
  }

  const cfgPerItem = distributePoints(configPts, diffMetrics.configChanges.length);
  for (const cfg of diffMetrics.configChanges.slice(0, 6)) {
    topRisks.push({
      ruleId: `config-${cfg.kind}`,
      severity: cfg.kind === 'ci-workflow' || cfg.kind === 'env-template' ? 'high' : 'medium',
      category: 'dependencyAndConfig',
      location: cfg.file,
      file: cfg.file,
      points: cfgPerItem,
      message: `Modified ${cfg.kind.replace('-', ' ')} (${cfg.churn} lines changed)`,
      evidence: `Detected sensitive config/dependency file (${cfg.kind})`,
    });
  }

  if (diffMetrics.totalLinesChanged > 500) {
    topRisks.push({
      ruleId: 'large-diff',
      severity: diffMetrics.totalLinesChanged > 900 ? 'high' : 'medium',
      category: 'linesChanged',
      location: '(branch diff)',
      points: linesPts,
      message: `Large PR diff (${diffMetrics.totalLinesChanged} lines across ${diffMetrics.totalFilesChanged} files) increases reviewer fatigue`,
      evidence: `${diffMetrics.totalLinesChanged} total insertions + deletions`,
    });
  }

  topRisks.sort((a, b) => {
    const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rankDiff !== 0) return rankDiff;
    if (b.points !== a.points) return b.points - a.points;
    return a.location.localeCompare(b.location);
  });

  const reviewFocus = buildReviewFocus(
    diffMetrics,
    largeFunctions,
    duplicates,
    riskyPatterns,
    missingDependencies,
  );

  return {
    toolVersion: TOOL_VERSION,
    branch: input.branch,
    baseRef: input.baseRef,
    score,
    level,
    signals,
    topRisks: topRisks.slice(0, 16),
    suppressed,
    missingDependencies,
    reviewFocus,
    metrics: {
      filesChanged: diffMetrics.totalFilesChanged,
      linesChanged: diffMetrics.totalLinesChanged,
      testFilesChanged: diffMetrics.testFiles.length,
      deletedTestFiles: diffMetrics.deletedTestFiles.length,
      criticalFilesTouched: diffMetrics.criticalMatches.length,
      configFilesChanged: diffMetrics.configChanges.length,
      duplicateBlocks: duplicates.length,
      largeFunctions: largeFunctions.length,
      riskyPatterns: riskyPatterns.length,
      suppressedCount: suppressed.length,
    },
  };
}

function buildReviewFocus(
  diffMetrics: DiffMetricsResult,
  largeFunctions: LargeFunctionFinding[],
  duplicates: DuplicateBlockFinding[],
  riskyPatterns: RiskyPatternFinding[],
  missingDependencies: string[],
): ReviewFocus[] {
  const focus: ReviewFocus[] = [];

  if (missingDependencies.length > 0) {
    focus.push({
      priority: 'P1',
      area: 'Missing npm dependencies',
      detail: `Imported but absent from package.json: ${missingDependencies.join(', ')} (run with --install-missing to install automatically).`,
    });
  }

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

  if (diffMetrics.deletedTestFiles.length > 0) {
    focus.push({
      priority: 'P1',
      area: 'Deleted tests',
      detail: `Confirm test coverage was not silently dropped by deleting ${diffMetrics.deletedTestFiles.slice(0, 3).join(', ')}.`,
    });
  }

  const nonDepPatterns = riskyPatterns.filter((p) => p.rule !== 'missing-dependency');
  if (nonDepPatterns.length > 0) {
    const first = nonDepPatterns[0]!;
    focus.push({
      priority: 'P1',
      area: 'Complexity & heuristic indicators',
      detail: `Review ${nonDepPatterns.length} flagged AST indicator(s) starting at ${first.file}:${first.line} (${first.rule}).`,
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

  if (diffMetrics.configChanges.length > 0) {
    focus.push({
      priority: 'P2',
      area: 'Dependencies & configuration',
      detail: `Verify package updates, permissions, and runtime impact in ${diffMetrics.configChanges.map((c) => c.file).slice(0, 3).join(', ')}.`,
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
