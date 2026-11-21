import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { ChangedFile, GitDiffResult, LineRange } from './types.js';

async function refExists(git: SimpleGit, ref: string): Promise<boolean> {
  try {
    const out = (await git.raw(['rev-parse', '--verify', `${ref}^{commit}`])).trim();
    return /^[0-9a-f]{7,40}$/i.test(out);
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

export function parseDiffHunkRanges(unifiedDiff: string): Record<string, LineRange[]> {
  const ranges: Record<string, LineRange[]> = {};
  let currentFile: string | null = null;

  for (const line of unifiedDiff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentFile = normalizePath(line.slice(6).trim());
      if (!ranges[currentFile]) ranges[currentFile] = [];
      continue;
    }

    if (line.startsWith('+++ /dev/null')) {
      currentFile = null;
      continue;
    }

    if (currentFile && line.startsWith('@@ ')) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!match) continue;
      const start = Number.parseInt(match[1] ?? '0', 10);
      const count = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
      if (start > 0 && count > 0) {
        ranges[currentFile]?.push([start, start + count - 1]);
      }
    }
  }

  return ranges;
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
    const [summary, nameStatusRaw, unifiedDiff] = await Promise.all([
      repoGit.diffSummary(['--cached']),
      repoGit.raw(['diff', '--cached', '--name-status']),
      repoGit.raw(['diff', '--cached', '-U0']),
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
      changedLineRanges: parseDiffHunkRanges(unifiedDiff),
      totalInsertions: summary.insertions,
      totalDeletions: summary.deletions,
    };
  }

  const resolvedBase = await resolveBaseRef(repoGit, baseBranch);
  // Three-dot range isolates commits on HEAD since it diverged from base
  const diffRange = `${resolvedBase}...HEAD`;

  const [summary, nameStatusRaw, unifiedDiff] = await Promise.all([
    repoGit.diffSummary([diffRange]),
    repoGit.raw(['diff', '--name-status', diffRange]),
    repoGit.raw(['diff', '-U0', diffRange]),
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
    changedLineRanges: parseDiffHunkRanges(unifiedDiff),
    totalInsertions: summary.insertions,
    totalDeletions: summary.deletions,
  };
}
