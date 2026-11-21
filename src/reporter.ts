import pc from 'picocolors';
import type { ScanReport, Severity } from './types.js';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLength(text: string): number {
  return text.replace(ANSI_RE, '').length;
}

function padEndVisible(text: string, width: number): string {
  const gap = Math.max(0, width - visibleLength(text));
  return text + ' '.repeat(gap);
}

function padStartVisible(text: string, width: number): string {
  const gap = Math.max(0, width - visibleLength(text));
  return ' '.repeat(gap) + text;
}

function colorSeverity(severity: Severity, text: string): string {
  switch (severity) {
    case 'critical':
      return pc.bgRed(pc.white(pc.bold(` ${text} `)));
    case 'high':
      return pc.red(pc.bold(text));
    case 'medium':
      return pc.yellow(text);
    case 'low':
      return pc.green(text);
  }
}

function renderRiskBar(score: number, level: Severity): string {
  const slots = 20;
  const filled = Math.round((score / 100) * slots);
  const bar = '█'.repeat(filled) + '░'.repeat(slots - filled);

  switch (level) {
    case 'critical':
    case 'high':
      return pc.red(bar);
    case 'medium':
      return pc.yellow(bar);
    case 'low':
      return pc.green(bar);
  }
}

function renderTable(headers: string[], rows: string[][], rightAlignCols: Set<number>): string {
  const colWidths = headers.map((h, i) => {
    const cellWidths = rows.map((row) => visibleLength(row[i] ?? ''));
    return Math.max(visibleLength(h), ...cellWidths);
  });

  const border = (left: string, mid: string, right: string) =>
    pc.dim(left + colWidths.map((w) => '─'.repeat(w + 2)).join(mid) + right);

  const formatRow = (cells: string[], isHeader = false) => {
    const formatted = cells.map((cell, i) => {
      const width = colWidths[i] ?? 0;
      const padded = rightAlignCols.has(i)
        ? padStartVisible(cell, width)
        : padEndVisible(cell, width);
      return isHeader ? pc.bold(padded) : padded;
    });
    return `${pc.dim('│')} ${formatted.join(` ${pc.dim('│')} `)} ${pc.dim('│')}`;
  };

  return [
    border('┌', '┬', '┐'),
    formatRow(headers, true),
    border('├', '┼', '┤'),
    ...rows.map((row) => formatRow(row)),
    border('└', '┴', '┘'),
  ].join('\n');
}

export function formatReport(report: ScanReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(
    `${pc.bold(pc.cyan('pr-risk-scanner'))}  ${pc.dim(`${report.branch} → ${report.baseRef}`)}`,
  );
  lines.push(
    `Risk Score: ${pc.bold(String(report.score))}${pc.dim('/100')}  ${renderRiskBar(report.score, report.level)}  ${colorSeverity(report.level, report.level.toUpperCase())}`,
  );
  lines.push('');

  const tableRows = report.signals.map((signal) => [
    signal.label,
    signal.observed,
    `${signal.points}/${signal.maxPoints}`,
    colorSeverity(signal.severity, signal.severity.toUpperCase()),
  ]);

  lines.push(
    renderTable(['Signal', 'Observed', 'Points', 'Status'], tableRows, new Set([2])),
  );

  lines.push('');
  lines.push(pc.bold('Top Risks'));
  if (report.topRisks.length === 0) {
    lines.push(`  ${pc.green('✓')} No major risk triggers found in this diff.`);
  } else {
    for (const risk of report.topRisks) {
      const badge = colorSeverity(risk.severity, risk.severity.toUpperCase().padEnd(8));
      const pts = risk.points > 0 ? pc.dim(`(+${risk.points})`) : '';
      lines.push(`  ${badge}  ${pc.cyan(risk.location)}  ${risk.message} ${pts}`);
    }
  }

  if (report.suppressed.length > 0) {
    lines.push('');
    lines.push(pc.bold(`Suppressed Findings (${report.suppressed.length})`));
    for (const item of report.suppressed) {
      lines.push(
        `  ${pc.dim('SUPPRESSED')}  ${pc.cyan(item.location)}  [${item.ruleId}] ${item.reason} ${pc.dim(`(${item.source})`)}`,
      );
    }
  }

  lines.push('');
  lines.push(pc.bold('Suggested Human Review Focus'));
  report.reviewFocus.forEach((item, idx) => {
    const tag =
      item.priority === 'P1'
        ? pc.red(pc.bold(item.priority))
        : item.priority === 'P2'
          ? pc.yellow(pc.bold(item.priority))
          : pc.blue(pc.bold(item.priority));
    lines.push(`  ${idx + 1}. [${tag}] ${pc.bold(item.area)} — ${item.detail}`);
  });

  lines.push('');
  return lines.join('\n');
}

export function formatMarkdownReport(report: ScanReport): string {
  const lines: string[] = [];

  lines.push(`## PR Risk Report — ${report.score}/100 (${report.level.toUpperCase()})`);
  lines.push('');
  lines.push(`Branch: \`${report.branch}\` → \`${report.baseRef}\``);
  lines.push('');
  lines.push('| Signal | Observed | Points | Status |');
  lines.push('| --- | --- | ---: | --- |');

  for (const signal of report.signals) {
    lines.push(
      `| ${signal.label} | ${signal.observed} | ${signal.points}/${signal.maxPoints} | **${signal.severity.toUpperCase()}** |`,
    );
  }

  lines.push('');
  if (report.topRisks.length === 0) {
    lines.push('No major risk triggers found in this diff.');
  } else {
    lines.push('<details>');
    lines.push(`<summary><strong>Top Risks (${report.topRisks.length})</strong></summary>`);
    lines.push('');
    for (const risk of report.topRisks) {
      lines.push(
        `- **${risk.severity.toUpperCase()}** \`${risk.location}\` (+${risk.points}) — ${risk.message} _(${risk.evidence})_`,
      );
    }
    lines.push('');
    lines.push('</details>');
  }

  if (report.suppressed.length > 0) {
    lines.push('');
    lines.push('<details>');
    lines.push(`<summary><strong>Suppressed Findings (${report.suppressed.length})</strong></summary>`);
    lines.push('');
    for (const item of report.suppressed) {
      lines.push(
        `- \`${item.location}\` \`[${item.ruleId}]\` — ${item.reason} _(${item.source})_`,
      );
    }
    lines.push('');
    lines.push('</details>');
  }

  lines.push('');
  lines.push('### Suggested Human Review Focus');
  report.reviewFocus.forEach((item, idx) => {
    lines.push(`${idx + 1}. **[${item.priority}] ${item.area}** — ${item.detail}`);
  });
  lines.push('');
  lines.push(
    '_Note: This score is a deterministic heuristic for review prioritization, not a bug probability estimate._',
  );
  lines.push('');

  return lines.join('\n');
}

function severityToSarifLevel(severity: Severity): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

export function formatSarifReport(report: ScanReport): string {
  const uniqueRules = new Map<string, { id: string; shortDescription: { text: string } }>();

  for (const risk of report.topRisks) {
    if (!uniqueRules.has(risk.ruleId)) {
      uniqueRules.set(risk.ruleId, {
        id: risk.ruleId,
        shortDescription: { text: `pr-risk-scanner heuristic: ${risk.ruleId}` },
      });
    }
  }

  const results = report.topRisks.map((risk) => ({
    ruleId: risk.ruleId,
    level: severityToSarifLevel(risk.severity),
    message: { text: `${risk.message} (${risk.evidence})` },
    locations: risk.file
      ? [
          {
            physicalLocation: {
              artifactLocation: { uri: risk.file },
              ...(risk.line
                ? { region: { startLine: risk.line } }
                : {}),
            },
          },
        ]
      : [],
    properties: {
      category: risk.category,
      points: risk.points,
    },
  }));

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'pr-risk-scanner',
            version: report.toolVersion,
            informationUri: 'https://github.com/AYUSH-PANDEY023/pr-risk-scanner',
            rules: [...uniqueRules.values()],
          },
        },
        properties: {
          branch: report.branch,
          baseRef: report.baseRef,
          riskScore: report.score,
          riskLevel: report.level,
          suppressedCount: report.suppressed.length,
        },
        results,
      },
    ],
  };

  return `${JSON.stringify(sarif, null, 2)}\n`;
}
