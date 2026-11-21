import fs from 'node:fs';
import path from 'node:path';
import type { ScannerConfig, ScanOptions } from './types.js';

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
};

const CONFIG_FILENAMES = ['pr-risk.config.json', '.pr-riskrc.json'];

function readJsonConfig(filePath: string): Partial<ScannerConfig> {
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

  return parsed as Partial<ScannerConfig>;
}

export function loadConfig(repoRoot: string, overrides: ScanOptions = {}): ScannerConfig {
  let fileConfig: Partial<ScannerConfig> = {};

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
    ...(overrides.base ? { baseBranch: overrides.base } : {}),
    ...(typeof overrides.threshold === 'number' ? { failThreshold: overrides.threshold } : {}),
    ...(typeof overrides.maxFunctionLines === 'number'
      ? { maxFunctionLines: overrides.maxFunctionLines }
      : {}),
  };
}
