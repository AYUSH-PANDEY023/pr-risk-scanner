import { describe, expect, it } from 'vitest';
import { applySuppressions } from '../src/suppression.js';

describe('suppression', () => {
  it('tracks inline, rule-level, and file-level suppressions without hiding them silently', () => {
    const res = applySuppressions(
      [
        {
          file: 'src/legacy/router.ts',
          name: 'mountRoutes',
          line: 10,
          endLine: 90,
          lineCount: 81,
        },
      ],
      [
        {
          file: 'src/eval.ts',
          line: 5,
          rule: 'unsafe-eval',
          severity: 'high',
          message: 'eval call',
          evidence: 'eval(...)',
          inlineSuppressionReason: 'intentional sandboxed formula parser',
        },
        {
          file: 'src/worker.ts',
          line: 22,
          rule: 'empty-catch',
          severity: 'medium',
          message: 'empty catch',
          evidence: '0 statements',
        },
        {
          file: 'src/active.ts',
          line: 40,
          rule: 'unsafe-exec',
          severity: 'high',
          message: 'exec call',
          evidence: 'exec(...)',
        },
      ],
      {
        disabledRules: ['empty-catch'],
        suppressions: [
          {
            rule: 'large-function',
            file: 'src/legacy/',
            reason: 'Legacy router scheduled for Q3 refactor',
          },
        ],
      },
    );

    expect(res.largeFunctions).toHaveLength(0);
    expect(res.riskyPatterns).toHaveLength(1);
    expect(res.riskyPatterns[0]?.rule).toBe('unsafe-exec');
    expect(res.suppressed).toHaveLength(3);
    expect(res.suppressed.map((s) => s.source)).toEqual([
      'config-rule-file',
      'inline',
      'config-rule',
    ]);
  });
});
