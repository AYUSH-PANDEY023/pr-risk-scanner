import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { ChangedFile, GitDiffResult } from './types.js';

async function refExists(git: SimpleGit, ref: string): Promise<boolean> {
  try {
    await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function resolveBaseRef(git: SimpleGit, requestedBase: string): Promise<string> {
  if (await refExists(git, requestedBase)) {
    return requestedBase;
  }

  const remoteFallback = `origin/${requestedBase}`;
  if (await refExists(git, remoteFallback)) {
    return remoteFallback;
  }

  throw new Error(
    `Base ref "${requestedBase}" not found (also checked "${remoteFallback}"). Pass --base <branch> to specify your base branch.`,
  );
}

function parseNameStatus(raw: string): Map<string, ChangedFile['status']> {
  const statusMap = new Map<string, ChangedFile['status']>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0];
    if (!code) continue;

    if (code.startsWith('R') || code.startsWith('C')) {
      const targetPath = parts[2];
      if (targetPath) statusMap.set(normalizePath(targetPath), 'renamed');
      continue;
    }

    const filePath = parts[1];
    if (!filePath) continue;
    const normalized = normalizePath(filePath);

    if (code === 'A') statusMap.set(normalized, 'added');
    else if (code === 'D') statusMap.set(normalized, 'deleted');
    else statusMap.set(normalized, 'modified');
  }
  return statusMap;
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export async function getGitDiff(
  cwd: string,
  baseBranch: string,
  staged = false,
): Promise<GitDiffResult> {
  const git = simpleGit({ baseDir: cwd });

  let repoRoot: string;
  try {
    repoRoot = (await git.revparse(['--show-toplevel'])).trim();
  } catch {
    throw new Error(`Not inside a git repository: ${path.resolve(cwd)}`);
  }

  const repoGit = simpleGit({ baseDir: repoRoot });
  const currentBranch = (await repoGit.revparse(['--abbrev-ref', 'HEAD'])).trim();

  if (staged) {
    const [summary, nameStatusRaw] = await Promise.all([
      repoGit.diffSummary(['--cached']),
      repoGit.raw(['diff', '--cached', '--name-status']),
    ]);

    const statusMap = parseNameStatus(nameStatusRaw);
    const files: ChangedFile[] = summary.files.map((entry) => {
      const cleanPath = normalizePath(entry.file);
      const isBinary = entry.binary;
      const insertions = !isBinary && 'insertions' in entry ? entry.insertions : 0;
      const deletions = !isBinary && 'deletions' in entry ? entry.deletions : 0;

      return {
        path: cleanPath,
        insertions,
        deletions,
        binary: isBinary,
        status: statusMap.get(cleanPath) ?? 'modified',
      };
    });

    return {
      repoRoot,
      currentBranch,
      baseRef: 'HEAD (staged)',
      files,
      totalInsertions: summary.insertions,
      totalDeletions: summary.deletions,
    };
  }

  const resolvedBase = await resolveBaseRef(repoGit, baseBranch);
  // Three-dot range isolates commits on HEAD since it diverged from base
  const diffRange = `${resolvedBase}...HEAD`;

  const [summary, nameStatusRaw] = await Promise.all([
    repoGit.diffSummary([diffRange]),
    repoGit.raw(['diff', '--name-status', diffRange]),
  ]);

  const statusMap = parseNameStatus(nameStatusRaw);
  const files: ChangedFile[] = summary.files.map((entry) => {
    const cleanPath = normalizePath(entry.file);
    const isBinary = entry.binary;
    const insertions = !isBinary && 'insertions' in entry ? entry.insertions : 0;
    const deletions = !isBinary && 'deletions' in entry ? entry.deletions : 0;

    return {
      path: cleanPath,
      insertions,
      deletions,
      binary: isBinary,
      status: statusMap.get(cleanPath) ?? 'modified',
    };
  });

  return {
    repoRoot,
    currentBranch,
    baseRef: resolvedBase,
    files,
    totalInsertions: summary.insertions,
    totalDeletions: summary.deletions,
  };
}
