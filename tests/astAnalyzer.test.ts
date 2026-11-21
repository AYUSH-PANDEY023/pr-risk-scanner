import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeAst, analyzeLargeFunctions } from '../src/analyzers/astAnalyzer.js';

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
  });

  it('ignores untouched legacy functions when diff line ranges are supplied', () => {
    const bodyLines = Array.from({ length: 18 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const source = [
      'export function legacyBig() {',
      bodyLines,
      '  return v0;',
      '}',
      '',
      'export function smallEdit() {',
      '  return 42;',
      '}',
    ].join('\n');

    const repoRoot = createTempRepo({ 'src/legacy.ts': source });

    const result = analyzeAst(
      repoRoot,
      [{ path: 'src/legacy.ts', insertions: 1, deletions: 1, binary: false, status: 'modified' }],
      { maxFunctionLines: 15 },
      { 'src/legacy.ts': [[23, 25]] },
    );

    expect(result.largeFunctions).toHaveLength(0);
  });

  it('detects empty catch, eval, new Function, child_process.exec, and unhandled promises', () => {
    const source = [
      "import { exec } from 'node:child_process';",
      'export function run(input: string, task: Promise<string>) {',
      '  task.then((res) => console.log(res));',
      '  try {',
      '    eval(input);',
      '    exec(input);',
      '    return new Function("return 1")();',
      '  } catch (err) {}',
      '}',
    ].join('\n');

    const repoRoot = createTempRepo({ 'src/unsafe.ts': source });

    const result = analyzeAst(
      repoRoot,
      [{ path: 'src/unsafe.ts', insertions: 9, deletions: 0, binary: false, status: 'added' }],
      { maxFunctionLines: 50 },
    );

    const rules = result.riskyPatterns.map((r) => r.rule);
    expect(rules).toContain('empty-catch');
    expect(rules).toContain('unsafe-eval');
    expect(rules).toContain('unsafe-exec');
    expect(rules).toContain('unsafe-function');
    expect(rules).toContain('unhandled-promise');
  });

  it('detects high cyclomatic complexity, deep nesting, oversized classes, and inline suppressions', () => {
    const methods = Array.from({ length: 6 }, (_, i) => `  m${i}() { return ${i}; }`).join('\n');
    const source = [
      'export function complexBranchy(a: number, b: number) {',
      '  if (a > 0) {',
      '    if (b > 0) {',
      '      for (let i = 0; i < a; i++) {',
      '        if (i % 2 === 0 && a > 1 && b > 1) {',
      '          return a > 10 || b > 10 ? 1 : 2;',
      '        }',
      '      }',
      '    }',
      '  }',
      '  return 0;',
      '}',
      '',
      'export class GiantService {',
      methods,
      '}',
      '',
      'export function suppressedEval(code: string) {',
      '  // pr-risk-ignore unsafe-eval -- sandboxed DSL compiler',
      '  return eval(code);',
      '}',
    ].join('\n');

    const repoRoot = createTempRepo({ 'src/complex.ts': source });

    const result = analyzeAst(
      repoRoot,
      [{ path: 'src/complex.ts', insertions: 25, deletions: 0, binary: false, status: 'added' }],
      {
        maxFunctionLines: 50,
        maxCyclomaticComplexity: 5,
        maxNestingDepth: 3,
        maxClassLines: 200,
        maxClassMethods: 4,
      },
    );

    const rules = result.riskyPatterns.map((r) => r.rule);
    expect(rules).toContain('high-complexity');
    expect(rules).toContain('deep-nesting');
    expect(rules).toContain('large-class');

    const evalFinding = result.riskyPatterns.find((r) => r.rule === 'unsafe-eval');
    expect(evalFinding?.inlineSuppressionReason).toBe('sandboxed DSL compiler');
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
