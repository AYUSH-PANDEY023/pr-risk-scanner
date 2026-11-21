import fs from 'node:fs';
import path from 'node:path';
import type { ScannerConfig, ScanOptions, SignalWeights } from './types.js';

export const DEFAULT_WEIGHTS: SignalWeights = {
  filesChanged: 12,
  linesChanged: 18,
  missingTests: 15,
  criticalPaths: 20,
  duplicateCode: 10,
  largeFunctions: 12,
  riskyPatterns: 13,
};

export const DEFAULT_CONFIG: ScannerConfig = {
  baseBranch: 'main',
  failThreshold: 70,
  criticalPaths: ['/auth', '/payments', '/migrations'],
  maxFunctionLines: 50,
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
  weights: { ...DEFAULT_WEIGHTS },
};

const CONFIG_FILENAMES = ['pr-risk.config.json', '.pr-riskrc.json'];

type PartialConfigFile = Partial<Omit<ScannerConfig, 'weights'>> & {
  weights?: Partial<SignalWeights>;
};

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

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
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
}
