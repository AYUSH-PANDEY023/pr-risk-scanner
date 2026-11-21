import path from 'node:path';
import type {
  ChangedFile,
  ConfigChangeFinding,
  DiffMetricsResult,
  ScannerConfig,
} from '../types.js';

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

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
]);

const RUNTIME_CONFIG_NAMES = new Set([
  'tsconfig.json',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.ts',
  'vite.config.js',
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
    } else if (clean.startsWith('*.')) {
      if (normalized.endsWith(clean.slice(1))) {
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

export function classifyConfigChange(filePath: string): ConfigChangeFinding['kind'] | null {
  const normalized = filePath.replace(/\\/g, '/');
  const baseLower = path.posix.basename(normalized).toLowerCase();

  if (baseLower === 'package.json') return 'dependency-manifest';
  if (LOCKFILE_NAMES.has(baseLower)) return 'lockfile';
  if (normalized.startsWith('.github/workflows/') && /\.ya?ml$/i.test(baseLower)) {
    return 'ci-workflow';
  }
  if (baseLower === '.env' || baseLower.startsWith('.env.')) return 'env-template';
  if (RUNTIME_CONFIG_NAMES.has(baseLower) || /^tsconfig\.[^/]+\.json$/i.test(baseLower)) {
    return 'runtime-config';
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
  const deletedTestFiles: string[] = [];
  const ignoredFiles: string[] = [];
  const criticalMatches: DiffMetricsResult['criticalMatches'] = [];
  const configChanges: ConfigChangeFinding[] = [];

  for (const file of files) {
    const configKind = classifyConfigChange(file.path);
    if (configKind) {
      configChanges.push({
        file: file.path,
        kind: configKind,
        churn: file.insertions + file.deletions,
      });
    }

    if (isIgnoredFile(file.path, config.ignoreFiles)) {
      ignoredFiles.push(file.path);
      continue;
    }

    if (isTestFile(file.path, config.testPatterns)) {
      testFiles.push(file);
      if (file.status === 'deleted') {
        deletedTestFiles.push(file.path);
      }
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

  const activeUpdatedTests = testFiles.filter((f) => f.status !== 'deleted');
  const missingTests =
    productionCodeChurn >= MIN_CODE_LINES_FOR_TEST_CHECK && activeUpdatedTests.length === 0;

  criticalMatches.sort((a, b) => b.churn - a.churn);

  return {
    sourceFiles,
    testFiles,
    deletedTestFiles,
    ignoredFiles,
    criticalMatches,
    configChanges,
    totalFilesChanged: activeFiles.length,
    totalLinesChanged,
    missingTests,
  };
}
