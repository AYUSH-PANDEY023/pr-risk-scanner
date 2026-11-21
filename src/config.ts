import fs from 'node:fs';
import path from 'node:path';
import type {
  ScannerConfig,
  ScanOptions,
  SeverityThresholds,
  SignalKey,
  SignalWeights,
  SuppressionRule,
} from './types.js';

export const DEFAULT_WEIGHTS: SignalWeights = {
  filesChanged: 10,
  linesChanged: 15,
  missingTests: 15,
  criticalPaths: 20,
  duplicateCode: 8,
  largeFunctions: 12,
  riskyPatterns: 12,
  dependencyAndConfig: 8,
};

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  medium: 30,
  high: 60,
  critical: 80,
};

export const DEFAULT_CONFIG: ScannerConfig = {
  baseBranch: 'main',
  failThreshold: 70,
  severityThresholds: { ...DEFAULT_SEVERITY_THRESHOLDS },
  criticalPaths: ['/auth', '/payments', '/migrations'],
  maxFunctionLines: 50,
  maxCyclomaticComplexity: 12,
  maxNestingDepth: 4,
  maxClassLines: 250,
  maxClassMethods: 15,
  duplicateMinLines: 6,
  duplicateMinTokens: 50,
  ignoreFiles: [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'dist/',
    'build/',
    '.next/',
    'coverage/',
  ],
  testPatterns: [
    '\\.test\\.[jt]sx?$',
    '\\.spec\\.[jt]sx?$',
    '(^|/)__tests__/',
    '(^|/)tests?/',
  ],
  disabledRules: [],
  suppressions: [],
  weights: { ...DEFAULT_WEIGHTS },
};

const CONFIG_FILENAMES = ['pr-risk.config.json', '.pr-riskrc.json'];

type PartialConfigFile = Partial<
  Omit<ScannerConfig, 'weights' | 'severityThresholds'>
> & {
  weights?: Partial<SignalWeights>;
  severityThresholds?: Partial<SeverityThresholds>;
};

function assertPositiveInt(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid config: "${label}" must be a positive integer.`);
  }
}

function assertNonNegativeNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new Error(`Invalid config: "${label}" must be a non-negative number.`);
  }
}

function assertStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid config: "${label}" must be an array of strings.`);
  }
}

export function validateConfig(config: ScannerConfig): void {
  if (typeof config.baseBranch !== 'string' || config.baseBranch.trim().length === 0) {
    throw new Error('Invalid config: "baseBranch" must be a non-empty string.');
  }

  if (
    typeof config.failThreshold !== 'number' ||
    Number.isNaN(config.failThreshold) ||
    config.failThreshold < 0 ||
    config.failThreshold > 100
  ) {
    throw new Error('Invalid config: "failThreshold" must be a number between 0 and 100.');
  }

  const { medium, high, critical } = config.severityThresholds;
  for (const [k, v] of Object.entries({ medium, high, critical })) {
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 100) {
      throw new Error(`Invalid config: "severityThresholds.${k}" must be between 0 and 100.`);
    }
  }
  if (!(medium < high && high < critical)) {
    throw new Error(
      'Invalid config: "severityThresholds" must satisfy medium < high < critical.',
    );
  }

  assertPositiveInt(config.maxFunctionLines, 'maxFunctionLines');
  assertPositiveInt(config.maxCyclomaticComplexity, 'maxCyclomaticComplexity');
  assertPositiveInt(config.maxNestingDepth, 'maxNestingDepth');
  assertPositiveInt(config.maxClassLines, 'maxClassLines');
  assertPositiveInt(config.maxClassMethods, 'maxClassMethods');
  assertPositiveInt(config.duplicateMinLines, 'duplicateMinLines');
  assertPositiveInt(config.duplicateMinTokens, 'duplicateMinTokens');

  assertStringArray(config.criticalPaths, 'criticalPaths');
  assertStringArray(config.ignoreFiles, 'ignoreFiles');
  assertStringArray(config.testPatterns, 'testPatterns');
  assertStringArray(config.disabledRules, 'disabledRules');

  for (const pattern of config.testPatterns) {
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`Invalid config: "testPatterns" contains invalid regex "${pattern}".`);
    }
  }

  if (!Array.isArray(config.suppressions)) {
    throw new Error('Invalid config: "suppressions" must be an array.');
  }
  for (const entry of config.suppressions) {
    const s = entry as Partial<SuppressionRule>;
    if (!s || typeof s !== 'object' || typeof s.reason !== 'string' || !s.reason.trim()) {
      throw new Error('Invalid config: every entry in "suppressions" requires a non-empty "reason".');
    }
    if (!s.rule && !s.file) {
      throw new Error(
        'Invalid config: every entry in "suppressions" must specify at least "rule" or "file".',
      );
    }
  }

  for (const key of Object.keys(DEFAULT_WEIGHTS) as SignalKey[]) {
    assertNonNegativeNumber(config.weights[key], `weights.${key}`);
  }
}

function readJsonConfig(filePath: string): PartialConfigFile {
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in config file ${filePath}: ${msg}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file ${filePath} must export a JSON object.`);
  }

  return parsed as PartialConfigFile;
}

export function loadConfig(repoRoot: string, overrides: ScanOptions = {}): ScannerConfig {
  let fileConfig: PartialConfigFile = {};

  if (overrides.configPath) {
    const resolved = path.resolve(repoRoot, overrides.configPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    fileConfig = readJsonConfig(resolved);
  } else {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(repoRoot, name);
      if (fs.existsSync(candidate)) {
        fileConfig = readJsonConfig(candidate);
        break;
      }
    }
  }

  const merged: ScannerConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    severityThresholds: {
      ...DEFAULT_SEVERITY_THRESHOLDS,
      ...(fileConfig.severityThresholds ?? {}),
    },
    weights: {
      ...DEFAULT_WEIGHTS,
      ...(fileConfig.weights ?? {}),
    },
    ...(overrides.base ? { baseBranch: overrides.base } : {}),
    ...(typeof overrides.threshold === 'number' ? { failThreshold: overrides.threshold } : {}),
    ...(typeof overrides.maxFunctionLines === 'number'
      ? { maxFunctionLines: overrides.maxFunctionLines }
      : {}),
  };

  validateConfig(merged);
  return merged;
}
