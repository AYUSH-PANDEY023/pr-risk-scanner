import type {
  LargeFunctionFinding,
  RiskyPatternFinding,
  ScannerConfig,
  SuppressedFinding,
  SuppressionRule,
} from './types.js';

function matchesFilePattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const clean = pattern.replace(/\\/g, '/');

  if (clean.endsWith('/')) {
    return normalized.startsWith(clean) || normalized.includes(`/${clean}`);
  }
  if (clean.startsWith('*.')) {
    return normalized.endsWith(clean.slice(1));
  }
  return normalized === clean || normalized.endsWith(`/${clean}`);
}

function matchConfigSuppression(
  ruleId: string,
  filePath: string,
  disabledRules: string[],
  suppressions: SuppressionRule[],
): { source: SuppressedFinding['source']; reason: string } | null {
  const ruleLower = ruleId.toLowerCase();

  if (disabledRules.some((r) => r.toLowerCase() === ruleLower)) {
    return {
      source: 'config-rule',
      reason: `Disabled globally via disabledRules in config`,
    };
  }

  for (const entry of suppressions) {
    const ruleMatch = !entry.rule || entry.rule.toLowerCase() === ruleLower;
    const fileMatch = !entry.file || matchesFilePattern(filePath, entry.file);
    if (ruleMatch && fileMatch) {
      return {
        source: 'config-rule-file',
        reason: entry.reason,
      };
    }
  }

  return null;
}

export function applySuppressions(
  largeFunctions: LargeFunctionFinding[],
  riskyPatterns: RiskyPatternFinding[],
  config: Pick<ScannerConfig, 'disabledRules' | 'suppressions'>,
): {
  largeFunctions: LargeFunctionFinding[];
  riskyPatterns: RiskyPatternFinding[];
  suppressed: SuppressedFinding[];
} {
  const activeFunctions: LargeFunctionFinding[] = [];
  const activePatterns: RiskyPatternFinding[] = [];
  const suppressed: SuppressedFinding[] = [];

  for (const fn of largeFunctions) {
    const location = `${fn.file}:${fn.line}`;
    if (fn.inlineSuppressionReason) {
      suppressed.push({
        ruleId: 'large-function',
        location,
        message: `${fn.name} is ${fn.lineCount} lines long`,
        source: 'inline',
        reason: fn.inlineSuppressionReason,
      });
      continue;
    }

    const cfgMatch = matchConfigSuppression(
      'large-function',
      fn.file,
      config.disabledRules,
      config.suppressions,
    );
    if (cfgMatch) {
      suppressed.push({
        ruleId: 'large-function',
        location,
        message: `${fn.name} is ${fn.lineCount} lines long`,
        source: cfgMatch.source,
        reason: cfgMatch.reason,
      });
      continue;
    }

    activeFunctions.push(fn);
  }

  for (const issue of riskyPatterns) {
    const location = `${issue.file}:${issue.line}`;
    if (issue.inlineSuppressionReason) {
      suppressed.push({
        ruleId: issue.rule,
        location,
        message: issue.message,
        source: 'inline',
        reason: issue.inlineSuppressionReason,
      });
      continue;
    }

    const cfgMatch = matchConfigSuppression(
      issue.rule,
      issue.file,
      config.disabledRules,
      config.suppressions,
    );
    if (cfgMatch) {
      suppressed.push({
        ruleId: issue.rule,
        location,
        message: issue.message,
        source: cfgMatch.source,
        reason: cfgMatch.reason,
      });
      continue;
    }

    activePatterns.push(issue);
  }

  return {
    largeFunctions: activeFunctions,
    riskyPatterns: activePatterns,
    suppressed,
  };
}
