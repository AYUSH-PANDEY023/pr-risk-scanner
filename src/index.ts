import { analyzeLargeFunctions } from './analyzers/astAnalyzer.js';
import { analyzeDiffMetrics } from './analyzers/diffMetrics.js';
import { analyzeDuplicates } from './analyzers/duplicateAnalyzer.js';
import { loadConfig } from './config.js';
import { getGitDiff } from './git.js';
import { buildScanReport } from './scoring.js';
import type { ScanOptions, ScanReport } from './types.js';

export type { ScanOptions, ScanReport, ScannerConfig } from './types.js';
export { formatReport } from './reporter.js';
export { loadConfig, DEFAULT_CONFIG } from './config.js';

export async function scanRepo(options: ScanOptions = {}): Promise<{
  report: ScanReport;
  failThreshold: number;
}> {
  const cwd = options.cwd ?? process.cwd();
  const provisionalConfig = loadConfig(cwd, options);
  const diff = await getGitDiff(cwd, provisionalConfig.baseBranch, Boolean(options.staged));

  // Re-resolve config from git repo root when invoked from a subdirectory
  const config = loadConfig(diff.repoRoot, options);
  const diffMetrics = analyzeDiffMetrics(diff.files, config);

  const nonIgnoredFiles = [...diffMetrics.sourceFiles, ...diffMetrics.testFiles];

  const [largeFunctions, duplicates] = await Promise.all([
    Promise.resolve(
      analyzeLargeFunctions(diff.repoRoot, nonIgnoredFiles, config.maxFunctionLines),
    ),
    analyzeDuplicates(diff.repoRoot, nonIgnoredFiles, config),
  ]);

  const report = buildScanReport({
    branch: diff.currentBranch,
    baseRef: diff.baseRef,
    diffMetrics,
    largeFunctions,
    duplicates,
    maxFunctionLines: config.maxFunctionLines,
  });

  return {
    report,
    failThreshold: config.failThreshold,
  };
}
