export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type SignalKey =
  | 'filesChanged'
  | 'linesChanged'
  | 'missingTests'
  | 'criticalPaths'
  | 'duplicateCode'
  | 'largeFunctions'
  | 'riskyPatterns'
  | 'dependencyAndConfig';

export type SignalWeights = Record<SignalKey, number>;

export interface SeverityThresholds {
  medium: number;
  high: number;
  critical: number;
}

export type LineRange = [startLine: number, endLine: number];

export interface ChangedFile {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface GitDiffResult {
  repoRoot: string;
  currentBranch: string;
  baseRef: string;
  files: ChangedFile[];
  changedLineRanges: Record<string, LineRange[]>;
  totalInsertions: number;
  totalDeletions: number;
}

export interface LargeFunctionFinding {
  file: string;
  name: string;
  line: number;
  endLine: number;
  lineCount: number;
  inlineSuppressionReason?: string;
}

export type AstPatternRule =
  | 'empty-catch'
  | 'unsafe-eval'
  | 'unsafe-function'
  | 'unsafe-exec'
  | 'dangerous-html'
  | 'high-complexity'
  | 'deep-nesting'
  | 'large-class'
  | 'unhandled-promise'
  | 'missing-dependency';

export type RiskyPatternRule = AstPatternRule;

export interface RiskyPatternFinding {
  file: string;
  line: number;
  rule: AstPatternRule;
  severity: Severity;
  message: string;
  evidence: string;
  packageName?: string;
  inlineSuppressionReason?: string;
}

export interface DuplicateBlockFinding {
  fileA: string;
  startLineA: number;
  endLineA: number;
  fileB: string;
  startLineB: number;
  endLineB: number;
  lines: number;
  tokens: number;
}

export interface ConfigChangeFinding {
  file: string;
  kind: 'dependency-manifest' | 'lockfile' | 'ci-workflow' | 'runtime-config' | 'env-template';
  churn: number;
}

export interface DiffMetricsResult {
  sourceFiles: ChangedFile[];
  testFiles: ChangedFile[];
  deletedTestFiles: string[];
  ignoredFiles: string[];
  criticalMatches: Array<{
    file: string;
    matchedPattern: string;
    churn: number;
  }>;
  configChanges: ConfigChangeFinding[];
  totalFilesChanged: number;
  totalLinesChanged: number;
  missingTests: boolean;
}

export interface SuppressionRule {
  rule?: string;
  file?: string;
  reason: string;
}

export interface SuppressedFinding {
  ruleId: string;
  location: string;
  message: string;
  source: 'inline' | 'config-rule' | 'config-rule-file';
  reason: string;
}

export interface SignalScore {
  key: SignalKey;
  label: string;
  observed: string;
  points: number;
  maxPoints: number;
  severity: Severity;
}

export interface RiskItem {
  ruleId: string;
  severity: Severity;
  category: SignalKey;
  location: string;
  file?: string;
  line?: number;
  points: number;
  message: string;
  evidence: string;
}

export interface ReviewFocus {
  priority: 'P1' | 'P2' | 'P3';
  area: string;
  detail: string;
}

export interface ScanReport {
  toolVersion: string;
  branch: string;
  baseRef: string;
  score: number;
  level: Severity;
  signals: SignalScore[];
  topRisks: RiskItem[];
  suppressed: SuppressedFinding[];
  missingDependencies: string[];
  reviewFocus: ReviewFocus[];
  metrics: {
    filesChanged: number;
    linesChanged: number;
    testFilesChanged: number;
    deletedTestFiles: number;
    criticalFilesTouched: number;
    configFilesChanged: number;
    duplicateBlocks: number;
    largeFunctions: number;
    riskyPatterns: number;
    suppressedCount: number;
  };
}

export interface ScannerConfig {
  baseBranch: string;
  failThreshold: number;
  severityThresholds: SeverityThresholds;
  criticalPaths: string[];
  maxFunctionLines: number;
  maxCyclomaticComplexity: number;
  maxNestingDepth: number;
  maxClassLines: number;
  maxClassMethods: number;
  duplicateMinLines: number;
  duplicateMinTokens: number;
  ignoreFiles: string[];
  testPatterns: string[];
  disabledRules: string[];
  suppressions: SuppressionRule[];
  weights: SignalWeights;
}

export interface ScanOptions {
  cwd?: string;
  base?: string;
  staged?: boolean;
  configPath?: string;
  threshold?: number;
  maxFunctionLines?: number;
}
