import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, validateConfig } from '../src/config.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-risk-cfg-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('config', () => {
  it('merges partial weights and thresholds while preserving defaults', () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, 'pr-risk.config.json'),
      JSON.stringify({
        failThreshold: 65,
        weights: { criticalPaths: 30 },
        severityThresholds: { medium: 25, high: 55, critical: 85 },
      }),
      'utf8',
    );

    const cfg = loadConfig(dir);
    expect(cfg.failThreshold).toBe(65);
    expect(cfg.weights.criticalPaths).toBe(30);
    expect(cfg.weights.filesChanged).toBe(DEFAULT_CONFIG.weights.filesChanged);
    expect(cfg.severityThresholds.high).toBe(55);
  });

  it('rejects malformed JSON and invalid threshold order', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'pr-risk.config.json'), '{ bad json', 'utf8');
    expect(() => loadConfig(dir)).toThrow(/Invalid JSON/);

    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        severityThresholds: { medium: 60, high: 40, critical: 80 },
      }),
    ).toThrow(/medium < high < critical/);
  });

  it('rejects invalid test regexes and suppressions without a reason', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        testPatterns: ['[unclosed'],
      }),
    ).toThrow(/invalid regex/);

    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        suppressions: [{ rule: 'empty-catch', reason: '' }],
      }),
    ).toThrow(/reason/);
  });
});
