import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { scanRepo } from '../dist/index.js';

function git(cwd, args) {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Bench',
      GIT_AUTHOR_EMAIL: 'bench@example.com',
      GIT_COMMITTER_NAME: 'Bench',
      GIT_COMMITTER_EMAIL: 'bench@example.com',
    },
  });
}

function createFixtureRepo(totalFiles, changedCount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-risk-bench-'));
  git(dir, ['init', '-b', 'main']);

  for (let i = 0; i < totalFiles; i++) {
    const file = path.join(dir, 'src', `mod_${i}.ts`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `export function fn_${i}(x: number) {\n  return x + ${i};\n}\n`,
      'utf8',
    );
  }
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'base']);
  git(dir, ['checkout', '-b', 'feat/bench']);

  for (let i = 0; i < changedCount; i++) {
    const file = path.join(dir, 'src', `mod_${i}.ts`);
    const lines = Array.from({ length: 30 }, (_, n) => `  const v${n} = x + ${n};`).join('\n');
    fs.writeFileSync(
      file,
      `export function fn_${i}(x: number) {\n${lines}\n  return v0;\n}\n`,
      'utf8',
    );
  }
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'feat: bench changes']);
  return dir;
}

const scenarios = [
  { name: 'small', totalFiles: 20, changedFiles: 3 },
  { name: 'medium', totalFiles: 150, changedFiles: 15 },
  { name: 'large', totalFiles: 500, changedFiles: 40 },
];

console.log(`Node ${process.version} | OS ${os.platform()} ${os.arch()}`);
console.log('| Scenario | Repo Files | Changed Files | Duration (ms) | Score |');
console.log('| --- | ---: | ---: | ---: | ---: |');

for (const s of scenarios) {
  const repo = createFixtureRepo(s.totalFiles, s.changedFiles);
  try {
    const t0 = performance.now();
    const { report } = await scanRepo({ cwd: repo, base: 'main' });
    const ms = Math.round(performance.now() - t0);
    console.log(
      `| ${s.name} | ${s.totalFiles} | ${s.changedFiles} | ${ms} | ${report.score}/100 |`,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}
