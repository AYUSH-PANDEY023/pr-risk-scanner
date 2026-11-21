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
      lines.push(`  ${badge}  ${pc.cyan(risk.location)}  ${risk.message}`);
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
