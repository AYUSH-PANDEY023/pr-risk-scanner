import { analyzeAst } from './analyzers/astAnalyzer.js';
import { analyzeDiffMetrics } from './analyzers/diffMetrics.js';
import { analyzeDuplicates } from './analyzers/duplicateAnalyzer.js';
import { loadConfig } from './config.js';
import { getGitDiff } from './git.js';
import { buildScanReport } from './scoring.js';
import { applySuppressions } from './suppression.js';
import type { ScanOptions, ScanReport } from './types.js';

export type {
  ScanOptions,
  ScanReport,
  ScannerConfig,
  SeverityThresholds,
  SignalWeights,
  SuppressedFinding,
  SuppressionRule,
} from './types.js';
export { formatReport, formatMarkdownReport, formatSarifReport } from './reporter.js';
export {
  loadConfig,
  validateConfig,
  DEFAULT_CONFIG,
  DEFAULT_WEIGHTS,
  DEFAULT_SEVERITY_THRESHOLDS,
} from './config.js';
export { TOOL_VERSION } from './scoring.js';

export async function scanRepo(options: ScanOptions = {}): Promise<{
  report: ScanReport;
  failThreshold: number;
  repoRoot: string;
}> {
  const cwd = options.cwd ?? process.cwd();
  const provisionalConfig = loadConfig(cwd, options);
  const diff = await getGitDiff(cwd, provisionalConfig.baseBranch, Boolean(options.staged));

  // Re-resolve config from git repo root when invoked from a subdirectory
  const config = loadConfig(diff.repoRoot, options);
  const diffMetrics = analyzeDiffMetrics(diff.files, config);

  const nonIgnoredFiles = [...diffMetrics.sourceFiles, ...diffMetrics.testFiles];

  const [astResult, duplicates] = await Promise.all([
    Promise.resolve(
      analyzeAst(
        diff.repoRoot,
        nonIgnoredFiles,
        {
          maxFunctionLines: config.maxFunctionLines,
          maxCyclomaticComplexity: config.maxCyclomaticComplexity,
          maxNestingDepth: config.maxNestingDepth,
          maxClassLines: config.maxClassLines,
          maxClassMethods: config.maxClassMethods,
        },
        diff.changedLineRanges,
      ),
    ),
    analyzeDuplicates(diff.repoRoot, nonIgnoredFiles, config),
  ]);

  const filtered = applySuppressions(
    astResult.largeFunctions,
    astResult.riskyPatterns,
    config,
  );

  const report = buildScanReport({
    branch: diff.currentBranch,
    baseRef: diff.baseRef,
    diffMetrics,
    largeFunctions: filtered.largeFunctions,
    riskyPatterns: filtered.riskyPatterns,
    duplicates,
    suppressed: filtered.suppressed,
    maxFunctionLines: config.maxFunctionLines,
    weights: config.weights,
    severityThresholds: config.severityThresholds,
  });

  return {
    report,
    failThreshold: config.failThreshold,
    repoRoot: diff.repoRoot,
  };
}
