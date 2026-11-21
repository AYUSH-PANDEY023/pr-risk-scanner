#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { DEFAULT_CONFIG, formatMarkdownReport, formatReport, scanRepo } from './index.js';

const program = new Command();

program
  .name('pr-risk-scanner')
  .description('Offline PR risk scorer based on git diff, AST analysis, and code duplication')
  .version('1.1.0')
  .option('-b, --base <branch>', 'base branch or ref to diff against (default: main)')
  .option('-c, --config <path>', 'path to local pr-risk.config.json')
  .option('--staged', 'analyze staged changes instead of branch diff against base', false)
  .option('--max-fn-lines <number>', 'line limit before flagging a function as large')
  .option('--threshold <number>', 'risk score threshold for --ci failure (default: 70)')
  .option('--ci', 'exit with code 1 if risk score meets or exceeds threshold', false)
  .option('--json', 'print raw JSON report instead of colored table', false)
  .option('--markdown', 'print GitHub-flavored Markdown report for PR comments', false)
  .option('--init', 'write a starter pr-risk.config.json in the current directory', false)
  .action(async (opts: {
    base?: string;
    config?: string;
    staged?: boolean;
    maxFnLines?: string;
    threshold?: string;
    ci?: boolean;
    json?: boolean;
    markdown?: boolean;
    init?: boolean;
  }) => {
    try {
      if (opts.init) {
        const target = path.resolve(process.cwd(), 'pr-risk.config.json');
        if (fs.existsSync(target)) {
          throw new Error(`Config already exists at ${target}`);
        }
        fs.writeFileSync(target, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
        process.stdout.write(`${pc.green('Created')} ${target}\n`);
        return;
      }

      const parsedThreshold =
        opts.threshold !== undefined ? Number.parseInt(opts.threshold, 10) : undefined;
      if (
        parsedThreshold !== undefined &&
        (Number.isNaN(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 100)
      ) {
        throw new Error('--threshold must be an integer between 0 and 100.');
      }

      const parsedMaxFn =
        opts.maxFnLines !== undefined ? Number.parseInt(opts.maxFnLines, 10) : undefined;
      if (parsedMaxFn !== undefined && (Number.isNaN(parsedMaxFn) || parsedMaxFn < 1)) {
        throw new Error('--max-fn-lines must be a positive integer.');
      }

      const { report, failThreshold } = await scanRepo({
        cwd: process.cwd(),
        base: opts.base,
        configPath: opts.config,
        staged: opts.staged,
        threshold: parsedThreshold,
        maxFunctionLines: parsedMaxFn,
      });

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else if (opts.markdown) {
        process.stdout.write(formatMarkdownReport(report));
      } else {
        process.stdout.write(formatReport(report));
      }

      if (opts.ci && report.score >= failThreshold) {
        if (!opts.json && !opts.markdown) {
          process.stderr.write(
            pc.red(`CI check failed: risk score ${report.score} >= threshold ${failThreshold}\n`),
          );
        }
        process.exitCode = 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${pc.red('Error:')} ${message}\n`);
      process.exitCode = 2;
    }
  });

program.parse();
