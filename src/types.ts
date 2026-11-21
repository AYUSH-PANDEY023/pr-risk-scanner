export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type SignalKey =
  | 'filesChanged'
  | 'linesChanged'
  | 'missingTests'
  | 'criticalPaths'
  | 'duplicateCode'
  | 'largeFunctions';

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
  totalInsertions: number;
  totalDeletions: number;
}

export interface LargeFunctionFinding {
  file: string;
  name: string;
  line: number;
  endLine: number;
  lineCount: number;
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

export interface DiffMetricsResult {
  sourceFiles: ChangedFile[];
  testFiles: ChangedFile[];
  ignoredFiles: string[];
  criticalMatches: Array<{
    file: string;
    matchedPattern: string;
    churn: number;
  }>;
  totalFilesChanged: number;
  totalLinesChanged: number;
  missingTests: boolean;
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
  severity: Severity;
  category: SignalKey;
  location: string;
  message: string;
}

export interface ReviewFocus {
  priority: 'P1' | 'P2' | 'P3';
  area: string;
  detail: string;
}

export interface ScanReport {
  branch: string;
  baseRef: string;
  score: number;
  level: Severity;
  signals: SignalScore[];
  topRisks: RiskItem[];
  reviewFocus: ReviewFocus[];
  metrics: {
    filesChanged: number;
    linesChanged: number;
    testFilesChanged: number;
    criticalFilesTouched: number;
    duplicateBlocks: number;
    largeFunctions: number;
  };
}

export interface ScannerConfig {
  baseBranch: string;
  failThreshold: number;
  criticalPaths: string[];
  maxFunctionLines: number;
  duplicateMinLines: number;
  duplicateMinTokens: number;
  ignoreFiles: string[];
  testPatterns: string[];
}

export interface ScanOptions {
  cwd?: string;
  base?: string;
  staged?: boolean;
  configPath?: string;
  threshold?: number;
  maxFunctionLines?: number;
}
