import { describe, expect, it } from 'vitest';
import { parseDiffHunkRanges } from '../src/git.js';

describe('parseDiffHunkRanges', () => {
  it('extracts added and modified line ranges per file', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -10,0 +11,4 @@',
      '+line1',
      '@@ -40,2 +44 @@',
      '+single',
      'diff --git a/src/old.ts b/src/old.ts',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,5 +0,0 @@',
    ].join('\n');

    const ranges = parseDiffHunkRanges(diff);
    expect(ranges['src/app.ts']).toEqual([
      [11, 14],
      [44, 44],
    ]);
    expect(ranges['src/old.ts']).toBeUndefined();
  });
});
