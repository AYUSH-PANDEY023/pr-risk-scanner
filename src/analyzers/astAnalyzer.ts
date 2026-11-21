import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { Node, Project, SyntaxKind, type SourceFile } from 'ts-morph';
import type {
  ChangedFile,
  LargeFunctionFinding,
  LineRange,
  RiskyPatternFinding,
} from '../types.js';

const PARSEABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const NODE_BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((m) => (m.startsWith('node:') ? m : `node:${m}`)),
]);

const NESTING_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.TryStatement,
]);

const INLINE_IGNORE_RE = /pr-risk-ignore(?:\s+([a-z0-9,-]+))?(?:\s+--\s*(.+))?$/i;

export interface AstThresholds {
  maxFunctionLines: number;
  maxCyclomaticComplexity?: number;
  maxNestingDepth?: number;
  maxClassLines?: number;
  maxClassMethods?: number;
}

export interface AstAnalysisResult {
  largeFunctions: LargeFunctionFinding[];
  riskyPatterns: RiskyPatternFinding[];
}

function loadDeclaredDependencies(repoRoot: string): Set<string> | null {
  const pkgPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    const deps = new Set<string>();
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const section = pkg[field];
      if (section && typeof section === 'object' && !Array.isArray(section)) {
        for (const name of Object.keys(section as Record<string, unknown>)) {
          deps.add(name);
        }
      }
    }
    return deps;
  } catch {
    return null;
  }
}

function extractPackageName(specifier: string): string | null {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('~/') ||
    specifier.startsWith('node:') ||
    NODE_BUILTINS.has(specifier)
  ) {
    return null;
  }

  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }

  const first = specifier.split('/')[0];
  return first && !NODE_BUILTINS.has(first) ? first : null;
}

function overlapsRanges(
  startLine: number,
  endLine: number,
  ranges: LineRange[] | undefined,
): boolean {
  if (!ranges) return true;
  if (ranges.length === 0) return false;
  return ranges.some(([rStart, rEnd]) => startLine <= rEnd && endLine >= rStart);
}

function getInlineSuppressionReason(
  sourceLines: string[],
  lineNumber: number,
  ruleId: string,
): string | undefined {
  for (const idx of [lineNumber - 1, lineNumber - 2]) {
    const raw = sourceLines[idx];
    if (!raw) continue;
    const match = INLINE_IGNORE_RE.exec(raw.trim());
    if (!match) continue;

    const targets = match[1]
      ? match[1]
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];

    if (targets.length === 0 || targets.includes('*') || targets.includes(ruleId.toLowerCase())) {
      return match[2]?.trim() || 'Suppressed via inline pr-risk-ignore comment';
    }
  }
  return undefined;
}

function inferCallableName(node: Node): string {
  if (Node.isFunctionDeclaration(node)) {
    return node.getName() ?? '<anonymous function>';
  }

  if (Node.isMethodDeclaration(node)) {
    const parentClass = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    const className = parentClass?.getName();
    return className ? `${className}.${node.getName()}` : node.getName();
  }

  const parent = node.getParent();
  if (parent) {
    if (Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
    if (Node.isPropertyAssignment(parent)) {
      return parent.getName();
    }
    if (Node.isPropertyDeclaration(parent)) {
      const parentClass = parent.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      const className = parentClass?.getName();
      return className ? `${className}.${parent.getName()}` : parent.getName();
    }
    if (Node.isBinaryExpression(parent)) {
      return parent.getLeft().getText();
    }
  }

  if (Node.isFunctionExpression(node) && node.getName()) {
    return node.getName() as string;
  }

  return '<anonymous>';
}

function computeCyclomaticComplexity(fn: Node): number {
  let complexity = 1;
  fn.forEachDescendant((descendant) => {
    const kind = descendant.getKind();
    if (
      kind === SyntaxKind.IfStatement ||
      kind === SyntaxKind.ForStatement ||
      kind === SyntaxKind.ForInStatement ||
      kind === SyntaxKind.ForOfStatement ||
      kind === SyntaxKind.WhileStatement ||
      kind === SyntaxKind.DoStatement ||
      kind === SyntaxKind.CaseClause ||
      kind === SyntaxKind.CatchClause ||
      kind === SyntaxKind.ConditionalExpression
    ) {
      complexity += 1;
      return;
    }

    if (Node.isBinaryExpression(descendant)) {
      const op = descendant.getOperatorToken().getKind();
      if (
        op === SyntaxKind.AmpersandAmpersandToken ||
        op === SyntaxKind.BarBarToken ||
        op === SyntaxKind.QuestionQuestionToken
      ) {
        complexity += 1;
      }
    }
  });
  return complexity;
}

function computeMaxNestingDepth(fn: Node): number {
  let maxDepth = 0;

  function walk(node: Node, depth: number): void {
    for (const child of node.getChildren()) {
      const kind = child.getKind();
      // Do not inflate outer function nesting with nested callbacks/functions
      if (
        child !== fn &&
        (kind === SyntaxKind.FunctionDeclaration ||
          kind === SyntaxKind.FunctionExpression ||
          kind === SyntaxKind.ArrowFunction)
      ) {
        continue;
      }

      const nextDepth = NESTING_KINDS.has(kind) ? depth + 1 : depth;
      if (nextDepth > maxDepth) maxDepth = nextDepth;
      walk(child, nextDepth);
    }
  }

  walk(fn, 0);
  return maxDepth;
}

function hasChildProcessImport(sourceFile: SourceFile): boolean {
  for (const imp of sourceFile.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (spec === 'child_process' || spec === 'node:child_process') {
      return true;
    }
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() === 'require') {
      const arg = call.getArguments()[0]?.getText().replace(/^['"]|['"]$/g, '');
      if (arg === 'child_process' || arg === 'node:child_process') {
        return true;
      }
    }
  }

  return false;
}

function isHandledThenCall(call: Node): boolean {
  const parent = call.getParent();
  if (!parent) return false;
  if (Node.isPropertyAccessExpression(parent) && parent.getName() === 'catch') {
    return true;
  }
  if (
    Node.isReturnStatement(parent) ||
    Node.isAwaitExpression(parent) ||
    Node.isVariableDeclaration(parent)
  ) {
    return true;
  }
  return Boolean(call.getFirstAncestorByKind(SyntaxKind.TryStatement));
}

function scanMissingDependencies(
  sourceFile: SourceFile,
  sourceLines: string[],
  filePath: string,
  ranges: LineRange[] | undefined,
  declaredDeps: Set<string> | null,
): RiskyPatternFinding[] {
  if (!declaredDeps) return [];
  const findings: RiskyPatternFinding[] = [];
  const reportedInFile = new Set<string>();

  const checkSpecifier = (specifier: string, line: number, endLine: number) => {
    if (!overlapsRanges(line, endLine, ranges)) return;
    const pkgName = extractPackageName(specifier);
    if (!pkgName || declaredDeps.has(pkgName) || reportedInFile.has(pkgName)) return;

    reportedInFile.add(pkgName);
    findings.push({
      file: filePath,
      line,
      rule: 'missing-dependency',
      severity: 'high',
      packageName: pkgName,
      message: `Imported package "${pkgName}" is missing from package.json`,
      evidence: `Import "${specifier}" not found in dependencies/devDependencies`,
      inlineSuppressionReason: getInlineSuppressionReason(
        sourceLines,
        line,
        'missing-dependency',
      ),
    });
  };

  for (const imp of sourceFile.getImportDeclarations()) {
    checkSpecifier(
      imp.getModuleSpecifierValue(),
      imp.getStartLineNumber(),
      imp.getEndLineNumber(),
    );
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() === 'require') {
      const firstArg = call.getArguments()[0];
      if (firstArg && Node.isStringLiteral(firstArg)) {
        checkSpecifier(
          firstArg.getLiteralValue(),
          call.getStartLineNumber(),
          call.getEndLineNumber(),
        );
      }
    }
  }

  return findings;
}

function scanRiskyPatterns(
  sourceFile: SourceFile,
  sourceLines: string[],
  filePath: string,
  ranges: LineRange[] | undefined,
  thresholds: AstThresholds,
  declaredDeps: Set<string> | null,
): RiskyPatternFinding[] {
  const findings: RiskyPatternFinding[] = [
    ...scanMissingDependencies(sourceFile, sourceLines, filePath, ranges, declaredDeps),
  ];
  const importsChildProcess = hasChildProcessImport(sourceFile);
  const maxClassLines = thresholds.maxClassLines ?? 250;
  const maxClassMethods = thresholds.maxClassMethods ?? 15;

  for (const cls of sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    const startLine = cls.getStartLineNumber();
    const endLine = cls.getEndLineNumber();
    if (!overlapsRanges(startLine, endLine, ranges)) continue;

    const lineCount = endLine - startLine + 1;
    const methodCount = cls.getMethods().length;
    if (lineCount > maxClassLines || methodCount > maxClassMethods) {
      const name = cls.getName() ?? '<anonymous class>';
      findings.push({
        file: filePath,
        line: startLine,
        rule: 'large-class',
        severity: 'medium',
        message: `Class ${name} is oversized (${lineCount} lines, ${methodCount} methods)`,
        evidence: `${lineCount} lines (limit ${maxClassLines}), ${methodCount} methods (limit ${maxClassMethods})`,
        inlineSuppressionReason: getInlineSuppressionReason(sourceLines, startLine, 'large-class'),
      });
    }
  }

  for (const clause of sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const block = clause.getBlock();
    if (block.getStatements().length === 0) {
      const line = clause.getStartLineNumber();
      if (overlapsRanges(line, clause.getEndLineNumber(), ranges)) {
        findings.push({
          file: filePath,
          line,
          rule: 'empty-catch',
          severity: 'medium',
          message: 'Empty catch block swallows errors without logging or handling',
          evidence: 'Catch clause body contains 0 executable statements',
          inlineSuppressionReason: getInlineSuppressionReason(sourceLines, line, 'empty-catch'),
        });
      }
    }
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const line = call.getStartLineNumber();
    if (!overlapsRanges(line, call.getEndLineNumber(), ranges)) continue;

    const expr = call.getExpression();
    const exprText = expr.getText();
    if (exprText === 'eval') {
      findings.push({
        file: filePath,
        line,
        rule: 'unsafe-eval',
        severity: 'high',
        message: 'Heuristic: direct eval() call can execute arbitrary code if input is untrusted',
        evidence: `Call expression "${exprText}(...)"`,
        inlineSuppressionReason: getInlineSuppressionReason(sourceLines, line, 'unsafe-eval'),
      });
    } else if (
      importsChildProcess &&
      (exprText === 'exec' ||
        exprText.endsWith('.exec') ||
        exprText === 'execSync' ||
        exprText.endsWith('.execSync'))
    ) {
      findings.push({
        file: filePath,
        line,
        rule: 'unsafe-exec',
        severity: 'high',
        message: `Heuristic: ${exprText}() invokes a shell; prefer execFile/spawn with explicit args`,
        evidence: `child_process shell call "${exprText}(...)"`,
        inlineSuppressionReason: getInlineSuppressionReason(sourceLines, line, 'unsafe-exec'),
      });
    } else if (
      Node.isPropertyAccessExpression(expr) &&
      expr.getName() === 'then' &&
      call.getArguments().length < 2 &&
      !isHandledThenCall(call)
    ) {
      findings.push({
        file: filePath,
        line,
        rule: 'unhandled-promise',
        severity: 'medium',
        message: 'Heuristic: .then() promise chain has no chained .catch() or enclosing try/catch',
        evidence: 'Standalone .then() call with single handler and no rejection handler',
        inlineSuppressionReason: getInlineSuppressionReason(sourceLines, line, 'unhandled-promise'),
      });
    }
  }

  for (const expr of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const line = expr.getStartLineNumber();
    if (!overlapsRanges(line, expr.getEndLineNumber(), ranges)) continue;

    if (expr.getExpression().getText() === 'Function') {
      findings.push({
        file: filePath,
        line,
        rule: 'unsafe-function',
        severity: 'high',
        message: 'Heuristic: dynamic new Function() constructor can execute arbitrary code',
        evidence: 'Dynamic Function constructor invocation',
        inlineSuppressionReason: getInlineSuppressionReason(sourceLines, line, 'unsafe-function'),
      });
    }
  }

  for (const attr of sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const line = attr.getStartLineNumber();
    if (!overlapsRanges(line, attr.getEndLineNumber(), ranges)) continue;

    if (attr.getNameNode().getText() === 'dangerouslySetInnerHTML') {
      findings.push({
        file: filePath,
        line,
        rule: 'dangerous-html',
        severity: 'high',
        message: 'Heuristic: dangerouslySetInnerHTML requires trusted or sanitized HTML',
        evidence: 'JSX attribute dangerouslySetInnerHTML',
        inlineSuppressionReason: getInlineSuppressionReason(sourceLines, line, 'dangerous-html'),
      });
    }
  }

  return findings;
}

export function analyzeAst(
  repoRoot: string,
  files: ChangedFile[],
  thresholdsOrMaxLines: number | AstThresholds,
  changedLineRanges?: Record<string, LineRange[]>,
): AstAnalysisResult {
  const thresholds: AstThresholds =
    typeof thresholdsOrMaxLines === 'number'
      ? { maxFunctionLines: thresholdsOrMaxLines }
      : thresholdsOrMaxLines;

  const maxComplexity = thresholds.maxCyclomaticComplexity ?? 12;
  const maxNesting = thresholds.maxNestingDepth ?? 4;

  const candidates = files.filter((file) => {
    if (file.status === 'deleted' || file.binary) return false;
    const ext = path.extname(file.path).toLowerCase();
    if (!PARSEABLE_EXTENSIONS.has(ext)) return false;
    return fs.existsSync(path.join(repoRoot, file.path));
  });

  if (candidates.length === 0) {
    return { largeFunctions: [], riskyPatterns: [] };
  }

  const declaredDeps = loadDeclaredDependencies(repoRoot);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
    },
  });

  const largeFunctions: LargeFunctionFinding[] = [];
  const riskyPatterns: RiskyPatternFinding[] = [];

  for (const file of candidates) {
    const absPath = path.join(repoRoot, file.path);
    const sourceFile = project.addSourceFileAtPathIfExists(absPath);
    if (!sourceFile) continue;

    const sourceLines = sourceFile.getFullText().split(/\r?\n/);
    const fileRanges = changedLineRanges ? changedLineRanges[file.path] : undefined;

    const callables = [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ];

    for (const fn of callables) {
      const startLine = fn.getStartLineNumber();
      const endLine = fn.getEndLineNumber();
      if (!overlapsRanges(startLine, endLine, fileRanges)) continue;

      const lineCount = endLine - startLine + 1;
      const name = inferCallableName(fn);

      if (lineCount > thresholds.maxFunctionLines) {
        largeFunctions.push({
          file: file.path,
          name,
          line: startLine,
          endLine,
          lineCount,
          inlineSuppressionReason: getInlineSuppressionReason(
            sourceLines,
            startLine,
            'large-function',
          ),
        });
      }

      const complexity = computeCyclomaticComplexity(fn);
      if (complexity > maxComplexity) {
        riskyPatterns.push({
          file: file.path,
          line: startLine,
          rule: 'high-complexity',
          severity: complexity >= maxComplexity + 8 ? 'high' : 'medium',
          message: `Function ${name} has high cyclomatic complexity (${complexity})`,
          evidence: `Measured ${complexity} decision paths (limit ${maxComplexity})`,
          inlineSuppressionReason: getInlineSuppressionReason(
            sourceLines,
            startLine,
            'high-complexity',
          ),
        });
      }

      const depth = computeMaxNestingDepth(fn);
      if (depth > maxNesting) {
        riskyPatterns.push({
          file: file.path,
          line: startLine,
          rule: 'deep-nesting',
          severity: depth >= maxNesting + 2 ? 'high' : 'medium',
          message: `Function ${name} has deep control-flow nesting (depth ${depth})`,
          evidence: `Max block nesting depth ${depth} (limit ${maxNesting})`,
          inlineSuppressionReason: getInlineSuppressionReason(
            sourceLines,
            startLine,
            'deep-nesting',
          ),
        });
      }
    }

    riskyPatterns.push(
      ...scanRiskyPatterns(
        sourceFile,
        sourceLines,
        file.path,
        fileRanges,
        thresholds,
        declaredDeps,
      ),
    );
  }

  largeFunctions.sort((a, b) => b.lineCount - a.lineCount);
  return { largeFunctions, riskyPatterns };
}

export function analyzeLargeFunctions(
  repoRoot: string,
  files: ChangedFile[],
  maxFunctionLines: number,
  changedLineRanges?: Record<string, LineRange[]>,
): LargeFunctionFinding[] {
  return analyzeAst(repoRoot, files, { maxFunctionLines }, changedLineRanges).largeFunctions;
}
