import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanRepo } from '../src/index.js';

const tempDirs: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Dev',
      GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'Test Dev',
      GIT_COMMITTER_EMAIL: 'dev@example.com',
    },
  }).trim();
}

function initTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-risk-int-'));
  tempDirs.push(dir);
  git(dir, ['init', '-b', 'main']);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-app', dependencies: { picocolors: '^1.0.0' } }, null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(dir, 'src/index.ts'), 'export const version = 1;\n', 'utf8');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('scanRepo integration', () => {
  it('returns score 0 on an empty diff and leaves the repository untouched', async () => {
    const repo = initTempGitRepo();
    const { report } = await scanRepo({ cwd: repo, base: 'main' });

    expect(report.score).toBe(0);
    expect(report.metrics.filesChanged).toBe(0);
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('scores a real feature branch with critical paths, large function, and missing dependency', async () => {
    const repo = initTempGitRepo();
    git(repo, ['checkout', '-b', 'feat/auth-flow']);

    fs.mkdirSync(path.join(repo, 'src/auth'), { recursive: true });
    const body = Array.from({ length: 55 }, (_, i) => `  const step${i} = token.length + ${i};`).join(
      '\n',
    );
    fs.writeFileSync(
      path.join(repo, 'src/auth/verify.ts'),
      [
        "import fs from 'node:fs';",
        "import pc from 'picocolors';",
        "import axios from 'axios';",
        'export function verifySession(token: string) {',
        '  void fs; void pc; void axios;',
        body,
        '  try {',
        '    return step0;',
        '  } catch {}',
        '}',
      ].join('\n'),
      'utf8',
    );
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'feat: add verifySession']);

    const { report } = await scanRepo({ cwd: repo, base: 'main' });

    expect(report.branch).toBe('feat/auth-flow');
    expect(report.metrics.criticalFilesTouched).toBe(1);
    expect(report.metrics.largeFunctions).toBe(1);
    expect(report.metrics.riskyPatterns).toBeGreaterThanOrEqual(2);
    expect(report.missingDependencies).toEqual(['axios']);
    expect(report.score).toBeGreaterThanOrEqual(25);
    expect(git(repo, ['status', '--porcelain'])).toBe('');
  });

  it('throws a clear error for an invalid base ref', async () => {
    const repo = initTempGitRepo();
    await expect(scanRepo({ cwd: repo, base: 'nonexistent-branch' })).rejects.toThrow(
      /Base ref "nonexistent-branch" not found/,
    );
  });
});
