import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeLargeFunctions } from '../src/analyzers/astAnalyzer.js';

const tempDirs: string[] = [];

function createTempRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-risk-ast-'));
  tempDirs.push(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('astAnalyzer', () => {
  it('flags functions and class methods exceeding maxFunctionLines', () => {
    const bodyLines = Array.from({ length: 18 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const source = [
      'export function smallHelper(x: number) {',
      '  return x * 2;',
      '}',
      '',
      'export function bigProcessor() {',
      bodyLines,
      '  return v0;',
      '}',
      '',
      'export class PaymentService {',
      '  charge() {',
      bodyLines,
      '    return v1;',
      '  }',
      '}',
    ].join('\n');

    const repoRoot = createTempRepo({ 'src/service.ts': source });

    const findings = analyzeLargeFunctions(
      repoRoot,
      [{ path: 'src/service.ts', insertions: 45, deletions: 0, binary: false, status: 'added' }],
      15,
    );

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.name)).toContain('bigProcessor');
    expect(findings.map((f) => f.name)).toContain('PaymentService.charge');
    expect(findings[0]?.line).toBeGreaterThan(0);
  });

  it('skips deleted and non-JS/TS files safely', () => {
    const repoRoot = createTempRepo({ 'README.md': '# Hello\n' });

    const findings = analyzeLargeFunctions(
      repoRoot,
      [
        { path: 'src/removed.ts', insertions: 0, deletions: 80, binary: false, status: 'deleted' },
        { path: 'README.md', insertions: 100, deletions: 0, binary: false, status: 'modified' },
      ],
      10,
    );

    expect(findings).toEqual([]);
  });
});
