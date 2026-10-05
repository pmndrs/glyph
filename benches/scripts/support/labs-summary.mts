import { appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type LabsRowStatus = 'faster' | 'slower' | 'neutral';

export interface LabsRow {
  readonly status: LabsRowStatus;
  readonly name: string;
  readonly baseline: string;
  readonly candidate: string;
  /** Δ p50 as a percentage, positive when the candidate is slower. */
  readonly delta: number;
  readonly p: string;
  readonly ci: string;
}

export interface LabsSkipped {
  readonly name: string;
  readonly reason: string;
}

export interface LabsComparison {
  readonly rows: readonly LabsRow[];
  readonly skipped: readonly LabsSkipped[];
  readonly warnings: readonly string[];
}

export interface LabsSummaryInput {
  readonly suite: string;
  readonly baseline: string;
  readonly candidate: string;
  readonly comparison: LabsComparison;
}

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');
const rowPattern = /^ {2}([▲▼■]) (.+?)\s+(\S+)\s+(\S+)\s+([+-]?[\d.]+)%\s+[+-]?[\d.]+%\s+(\S+)\s+(\S+%)$/u;
const skippedPattern = /^ {2}· (.+?) {2}(.+)$/u;
const statusOf = { '▲': 'faster', '▼': 'slower', '■': 'neutral' } as const;

/**
 * Reads the report `labs compare` prints. Labs truncates names to 36 columns, so `runNames` (the candidate result's full
 * run names, in report order) restores each one; a name with no match keeps its printed form.
 */
export function parseLabsComparison(report: string, runNames: readonly string[]): LabsComparison {
  const unused = [...runNames];
  const fullName = (printed: string): string => {
    if (!printed.endsWith('…')) return printed;
    const prefix = printed.slice(0, -1);
    const index = unused.findIndex((name) => name.startsWith(prefix));
    return index === -1 ? printed : unused.splice(index, 1)[0]!;
  };
  const rows: LabsRow[] = [];
  const skipped: LabsSkipped[] = [];
  const warnings: string[] = [];
  let inSkipped = false;
  let category = '';
  for (const line of report.replace(ansi, '').split('\n')) {
    if (line.startsWith('skipped (')) inSkipped = true;
    else if (line.startsWith('summary')) inSkipped = false;
    if (inSkipped) {
      const match = skippedPattern.exec(line);
      if (match !== null) {
        skipped.push({ name: match[1]!.trim(), reason: `${category}${match[2]!.trim()}` });
      } else if (/^ {2}\S/u.test(line)) category = `${line.trim()}: `;
      continue;
    }
    if (line.startsWith('⚠') && !line.startsWith('⚠ Limited resolution')) warnings.push(line.slice(1).trim());
    const match = rowPattern.exec(line);
    if (match === null) continue;
    rows.push({
      status: statusOf[match[1] as keyof typeof statusOf],
      name: fullName(match[2]!.trim()),
      baseline: match[3]!,
      candidate: match[4]!,
      delta: Number(match[5]),
      p: match[6]!,
      ci: match[7]!,
    });
  }
  return {
    rows,
    skipped: skipped.map(({ name, reason }) => ({ name: fullName(name), reason })),
    warnings,
  };
}

export function renderLabsSummary({ suite, baseline, candidate, comparison }: LabsSummaryInput): string {
  const { rows, skipped, warnings } = comparison;
  const slower = rows.filter((row) => row.status === 'slower').sort((a, b) => b.delta - a.delta);
  const faster = rows.filter((row) => row.status === 'faster').sort((a, b) => b.delta - a.delta);
  const neutral = rows.filter((row) => row.status === 'neutral');
  const changed = [...slower, ...faster];
  const lines = [
    `## Package performance: \`${suite}\` suite`,
    '',
    `${faster.length} faster · ${slower.length} slower · ${neutral.length} neutral · ${skipped.length} skipped`,
    '',
    `Baseline \`${baseline}\` → candidate \`${candidate}\``,
    '',
    ...warnings.map((warning) => `> ⚠ ${warning}`),
    ...(warnings.length === 0 ? [] : ['']),
  ];
  if (changed.length === 0) {
    lines.push(`All ${rows.length} compared benches are neutral.`, '');
  } else {
    lines.push(...table(changed.map((row) => cells(row, row.status === 'slower' ? '🔴 slower' : '🟢 faster'))), '');
    lines.push(...chart(suite, changed, neutral), '');
  }
  const rest = [
    ...neutral.map((row) => cells(row, 'neutral')),
    ...skipped.map(({ name, reason }) => [`skipped: ${escapeCell(reason)}`, escapeCell(name), '', '', '', '', '']),
  ];
  lines.push(`<details><summary>${neutral.length} neutral, ${skipped.length} skipped</summary>`, '');
  lines.push(...(rest.length === 0 ? ['Nothing else was compared.'] : table(rest)), '', '</details>', '');
  return lines.join('\n');
}

/** Appends the summary to the Actions job summary when one exists, and always writes `summary.md` under `output`. */
export async function writeLabsSummary(
  markdown: string,
  output: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  await writeFile(resolve(output, 'summary.md'), markdown);
  const jobSummary = environment.GITHUB_STEP_SUMMARY;
  if (jobSummary !== undefined && jobSummary !== '') await appendFile(jobSummary, `${markdown}\n`);
}

function cells(row: LabsRow, status: string): readonly string[] {
  return [status, escapeCell(row.name), row.baseline, row.candidate, signed(row.delta), row.p, row.ci];
}

function table(body: readonly (readonly string[])[]): readonly string[] {
  const header = ['status', 'bench', 'baseline', 'candidate', 'Δ p50', 'p', '95% CI'];
  const row = (values: readonly string[]) => `| ${values.join(' | ')} |`;
  return [row(header), row(header.map(() => '---')), ...body.map(row)];
}

/** Bar colours by status, in the order their series are drawn: GitHub's danger, success, and muted greys. */
const chartColors: Readonly<Record<LabsRowStatus, string>> = {
  slower: '#cf222e',
  faster: '#1a7f37',
  neutral: '#8c959f',
};
/** Beyond this many benches the chart keeps only the ones that moved, so it still fits a viewport. */
const chartRowLimit = 24;
const chartLabelLength = 32;

/**
 * Mermaid's xychart draws every bar from the axis minimum and colours by series, not by bar. So the chart plots
 * |Δ p50| from 0, gives each status its own series (zero elsewhere) for a red/green/grey bar, and carries the sign
 * in the label. Width and height follow the bar count, so the chart stays compact.
 */
function chart(suite: string, changed: readonly LabsRow[], neutral: readonly LabsRow[]): readonly string[] {
  const plotted =
    changed.length + neutral.length <= chartRowLimit
      ? [...changed, ...[...neutral].sort((a, b) => b.delta - a.delta)]
      : changed;
  const limit = Math.max(5, Math.ceil(Math.max(...plotted.map((row) => Math.abs(row.delta))) / 5) * 5);
  const seen = new Set<string>();
  const labels = plotted.map((row) => {
    const value = signedNumber(row.delta);
    const base = mermaidLabel(row.name, chartLabelLength - value.length - 1);
    let name = base;
    for (let n = 2; seen.has(name); n += 1) name = `${base.slice(0, base.length - String(n).length - 1)}~${String(n)}`;
    seen.add(name);
    return `"${name} ${value}"`;
  });
  const statuses = (['slower', 'faster', 'neutral'] as const).filter((status) =>
    plotted.some((row) => row.status === status),
  );
  const series = statuses.map(
    (status) =>
      `  bar [${plotted.map((row) => (row.status === status ? String(Math.abs(row.delta)) : '0')).join(', ')}]`,
  );
  return [
    '```mermaid',
    '---',
    'config:',
    '  xyChart:',
    '    width: 640',
    `    height: ${String(Math.max(140, 64 + 26 * plotted.length))}`,
    '    titleFontSize: 14',
    '    xAxis:',
    '      labelFontSize: 12',
    '    yAxis:',
    '      labelFontSize: 11',
    '      titleFontSize: 12',
    '  themeVariables:',
    '    xyChart:',
    `      plotColorPalette: "${statuses.map((status) => chartColors[status]).join(', ')}"`,
    '---',
    'xychart-beta horizontal',
    `  title "${mermaidLabel(suite, 64)} suite: Δ p50 vs baseline"`,
    `  x-axis [${labels.join(', ')}]`,
    `  y-axis "size of Δ p50 in %, red slower, green faster, grey neutral" 0 --> ${String(limit)}`,
    ...series,
    '```',
  ];
}

/** A signed one-decimal number with no `%`, which Mermaid labels cannot carry. */
function signedNumber(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
}

/** Quotes, brackets, and separators end a Mermaid string or list early, so they never reach the chart. */
function mermaidLabel(name: string, max = 32): string {
  const clean = name
    .replace(/["'`[\](){}|\\,;#%]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function escapeCell(value: string): string {
  return value.replace(/\|/gu, '\\|');
}

function signed(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
}
