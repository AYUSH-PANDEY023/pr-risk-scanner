import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { detectClones as DetectClonesFn } from 'jscpd';
import { normalizePath } from '../git.js';
import type { ChangedFile, DuplicateBlockFinding, ScannerConfig } from '../types.js';

// Load jscpd via CJS to avoid its ESM bundle's extensionless colors/safe import on Node 20+
const require = createRequire(import.meta.url);
const { detectClones } = require('jscpd') as { detectClones: typeof DetectClonesFn };

function toRepoRelative(repoRoot: string, filePath: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  return normalizePath(path.relative(repoRoot, abs));
}

export async function analyzeDuplicates(
  repoRoot: string,
  changedFiles: ChangedFile[],
  config: ScannerConfig,
): Promise<DuplicateBlockFinding[]> {
  const activeChangedPaths = new Set(
    changedFiles
      .filter((f) => f.status !== 'deleted' && !f.binary)
      .filter((f) => fs.existsSync(path.join(repoRoot, f.path)))
      .map((f) => normalizePath(f.path)),
  );

  if (activeChangedPaths.size === 0) {
    return [];
  }

  const ignoreGlobs = [
    '**/node_modules/**',
    '**/.git/**',
    ...config.ignoreFiles.map((entry) =>
      entry.endsWith('/') ? `**/${entry}**` : `**/${entry}`,
    ),
  ];

  let clones: Awaited<ReturnType<typeof detectClones>>;
  try {
    clones = await detectClones({
      path: [repoRoot],
      silent: true,
      minLines: config.duplicateMinLines,
      minTokens: config.duplicateMinTokens,
      ignore: ignoreGlobs,
      gitignore: true,
    });
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const findings: DuplicateBlockFinding[] = [];

  for (const clone of clones) {
    const fileA = toRepoRelative(repoRoot, clone.duplicationA.sourceId);
    const fileB = toRepoRelative(repoRoot, clone.duplicationB.sourceId);

    // Only report duplicates involving at least one file modified in this PR
    if (!activeChangedPaths.has(fileA) && !activeChangedPaths.has(fileB)) {
      continue;
    }

    const startLineA = clone.duplicationA.start.line;
    const endLineA = clone.duplicationA.end.line;
    const startLineB = clone.duplicationB.start.line;
    const endLineB = clone.duplicationB.end.line;

    const pairKey = [
      `${fileA}:${startLineA}-${endLineA}`,
      `${fileB}:${startLineB}-${endLineB}`,
    ]
      .sort()
      .join('::');

    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const lines = Math.max(endLineA - startLineA + 1, endLineB - startLineB + 1);
    findings.push({
      fileA,
      startLineA,
      endLineA,
      fileB,
      startLineB,
      endLineB,
      lines,
      tokens: Math.max(
        0,
        (clone.duplicationA.end.position ?? 0) - (clone.duplicationA.start.position ?? 0),
      ),
    });
  }

  findings.sort((a, b) => b.lines - a.lines);
  return findings;
}
