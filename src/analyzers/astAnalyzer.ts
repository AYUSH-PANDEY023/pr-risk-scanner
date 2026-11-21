import fs from 'node:fs';
import path from 'node:path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import type { ChangedFile, LargeFunctionFinding } from '../types.js';

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

export function analyzeLargeFunctions(
  repoRoot: string,
  files: ChangedFile[],
  maxFunctionLines: number,
): LargeFunctionFinding[] {
  const candidates = files.filter((file) => {
    if (file.status === 'deleted' || file.binary) return false;
    const ext = path.extname(file.path).toLowerCase();
    if (!PARSEABLE_EXTENSIONS.has(ext)) return false;
    return fs.existsSync(path.join(repoRoot, file.path));
  });

  if (candidates.length === 0) {
    return [];
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
    },
  });

  const findings: LargeFunctionFinding[] = [];

  for (const file of candidates) {
    const absPath = path.join(repoRoot, file.path);
    const sourceFile = project.addSourceFileAtPathIfExists(absPath);
    if (!sourceFile) continue;

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

      if (lineCount > maxFunctionLines) {
        findings.push({
          file: file.path,
          name: inferCallableName(fn),
          line: startLine,
          endLine,
          lineCount,
        });
      }
    }
  }

  findings.sort((a, b) => b.lineCount - a.lineCount);
  return findings;
}
