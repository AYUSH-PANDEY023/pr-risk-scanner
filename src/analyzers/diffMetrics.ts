import path from 'node:path';
import type { ChangedFile, DiffMetricsResult, ScannerConfig } from '../types.js';

const NON_CODE_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.css',
  '.scss',
  '.less',
]);

const MIN_CODE_LINES_FOR_TEST_CHECK = 15;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isIgnoredFile(filePath: string, ignorePatterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const baseName = path.posix.basename(normalized);

  for (const pattern of ignorePatterns) {
    const clean = pattern.replace(/\\/g, '/');
    if (clean.endsWith('/')) {
      if (normalized.startsWith(clean) || normalized.includes(`/${clean}`)) {
        return true;
      }
    } else if (normalized === clean || baseName === clean) {
      return true;
    }
  }

  return false;
}

export function isTestFile(filePath: string, testPatterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return testPatterns.some((raw) => new RegExp(raw, 'i').test(normalized));
}

export function matchCriticalPath(filePath: string, criticalPaths: string[]): string | null {
  const normalized = filePath.replace(/\\/g, '/');

  for (const rawPattern of criticalPaths) {
    const segment = rawPattern.replace(/^\/+|\/+$/g, '');
    if (!segment) continue;

    // Match whole path segments so "/auth" matches "src/auth/jwt.ts" but not "src/author.ts"
    const re = new RegExp(`(^|/)${escapeRegex(segment)}(/|$|\\.)`, 'i');
    if (re.test(normalized)) {
      return rawPattern;
    }
  }

  return null;
}

function isProductionCodeFile(file: ChangedFile): boolean {
  if (file.binary || file.status === 'deleted') return false;
  const ext = path.posix.extname(file.path).toLowerCase();
  return ext.length > 0 && !NON_CODE_EXTENSIONS.has(ext);
}

export function analyzeDiffMetrics(
  files: ChangedFile[],
  config: ScannerConfig,
): DiffMetricsResult {
  const sourceFiles: ChangedFile[] = [];
  const testFiles: ChangedFile[] = [];
  const ignoredFiles: string[] = [];
  const criticalMatches: DiffMetricsResult['criticalMatches'] = [];

  for (const file of files) {
    if (isIgnoredFile(file.path, config.ignoreFiles)) {
      ignoredFiles.push(file.path);
      continue;
    }

    if (isTestFile(file.path, config.testPatterns)) {
      testFiles.push(file);
    } else {
      sourceFiles.push(file);
    }

    const matchedPattern = matchCriticalPath(file.path, config.criticalPaths);
    if (matchedPattern && !isTestFile(file.path, config.testPatterns)) {
      criticalMatches.push({
        file: file.path,
        matchedPattern,
        churn: file.insertions + file.deletions,
      });
    }
  }

  const activeFiles = [...sourceFiles, ...testFiles];
  const totalLinesChanged = activeFiles.reduce(
    (sum, f) => sum + f.insertions + f.deletions,
    0,
  );

  const productionCodeChurn = sourceFiles
    .filter(isProductionCodeFile)
    .reduce((sum, f) => sum + f.insertions + f.deletions, 0);

  const missingTests =
    productionCodeChurn >= MIN_CODE_LINES_FOR_TEST_CHECK && testFiles.length === 0;

  criticalMatches.sort((a, b) => b.churn - a.churn);

  return {
    sourceFiles,
    testFiles,
    ignoredFiles,
    criticalMatches,
    totalFilesChanged: activeFiles.length,
    totalLinesChanged,
    missingTests,
  };
}
