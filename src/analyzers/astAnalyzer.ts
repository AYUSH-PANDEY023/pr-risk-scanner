import fs from 'node:fs';
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

export interface AstAnalysisResult {
  largeFunctions: LargeFunctionFinding[];
  riskyPatterns: RiskyPatternFinding[];
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

function hasChildProcessExecImport(sourceFile: SourceFile): boolean {
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

function scanRiskyPatterns(
  sourceFile: SourceFile,
  filePath: string,
  ranges: LineRange[] | undefined,
): RiskyPatternFinding[] {
  const findings: RiskyPatternFinding[] = [];
  const importsChildProcess = hasChildProcessExecImport(sourceFile);

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
        });
      }
    }
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const line = call.getStartLineNumber();
    if (!overlapsRanges(line, call.getEndLineNumber(), ranges)) continue;

    const exprText = call.getExpression().getText();
    if (exprText === 'eval') {
      findings.push({
        file: filePath,
        line,
        rule: 'unsafe-eval',
        severity: 'high',
        message: 'Direct eval() call introduces arbitrary code execution risk',
      });
    } else if (
      importsChildProcess &&
      (exprText === 'exec' || exprText.endsWith('.exec') || exprText === 'execSync' || exprText.endsWith('.execSync'))
    ) {
      findings.push({
        file: filePath,
        line,
        rule: 'unsafe-exec',
        severity: 'high',
        message: `${exprText}() runs a shell command; prefer execFile/spawn with explicit args`,
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
        message: 'Dynamic new Function() constructor introduces code injection risk',
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
        message: 'dangerouslySetInnerHTML can introduce XSS if HTML is not sanitized',
      });
    }
  }

  return findings;
}

export function analyzeAst(
  repoRoot: string,
  files: ChangedFile[],
  maxFunctionLines: number,
  changedLineRanges?: Record<string, LineRange[]>,
): AstAnalysisResult {
  const candidates = files.filter((file) => {
    if (file.status === 'deleted' || file.binary) return false;
    const ext = path.extname(file.path).toLowerCase();
    if (!PARSEABLE_EXTENSIONS.has(ext)) return false;
    return fs.existsSync(path.join(repoRoot, file.path));
  });

  if (candidates.length === 0) {
    return { largeFunctions: [], riskyPatterns: [] };
  }

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
      const lineCount = endLine - startLine + 1;

      if (lineCount > maxFunctionLines && overlapsRanges(startLine, endLine, fileRanges)) {
        largeFunctions.push({
          file: file.path,
          name: inferCallableName(fn),
          line: startLine,
          endLine,
          lineCount,
        });
      }
    }

    riskyPatterns.push(...scanRiskyPatterns(sourceFile, file.path, fileRanges));
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
  return analyzeAst(repoRoot, files, maxFunctionLines, changedLineRanges).largeFunctions;
}
