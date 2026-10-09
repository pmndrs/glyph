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
  /** Labs' block-median distribution sparklines, when the report printed them under the row. */
  readonly baselineSpark?: string;
  readonly candidateSpark?: string;
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
const sparkPattern = /^\s+([▁▂▃▄▅▆▇█]+) ([▁▂▃▄▅▆▇█]+)/u;
const statusOf = { '▲': 'faster', '▼': 'slower', '■': 'neutral' } as const;

/**
 * Reads the report `labs compare` prints. Labs truncates names to 36 columns, so `runNames` (the candidate result's full
 * run names, in report order) restores each one; a name with no match keeps its printed form.
 */
export function parseLabsComparison(
  report: string,
  runNames: readonly string[],
  excludedTimingNames: readonly string[] = [],
): LabsComparison {
  const unused = [...runNames];
  const fullName = (printed: string): string => {
    if (!printed.endsWith('…')) return printed;
    const prefix = printed.slice(0, -1);
    const index = unused.findIndex((name) => name.startsWith(prefix));
    return index === -1 ? printed : unused.splice(index, 1)[0]!;
  };
  const rows: { -readonly [Key in keyof LabsRow]: LabsRow[Key] }[] = [];
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
    const spark = sparkPattern.exec(line);
    const last = rows.at(-1);
    if (spark !== null && last !== undefined && last.baselineSpark === undefined) {
      last.baselineSpark = spark[1]!;
      last.candidateSpark = spark[2]!;
      continue;
    }
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
  const excluded = new Set(excludedTimingNames);
  return {
    rows: rows.filter((row) => !excluded.has(row.name)),
    skipped: [
      ...skipped.map(({ name, reason }) => ({ name: fullName(name), reason })),
      ...rows.filter((row) => excluded.has(row.name)).map(({ name }) => ({ name, reason: 'timing-mode mismatch' })),
    ],
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
  lines.push(...latencyDistribution(rows));
  if (rows.length > 0) lines.push(...forestPlot([...changed, ...[...neutral].sort((a, b) => b.delta - a.delta)]), '');
  if (changed.length === 0) {
    lines.push(`All ${rows.length} compared benches are neutral.`, '');
  } else {
    lines.push(...table(changed.map((row) => cells(row, row.status === 'slower' ? '🔴 slower' : '🟢 faster'))), '');
  }
  const rest = [
    ...neutral.map((row) => cells(row, 'neutral')),
    ...skipped.map(({ name, reason }) => [`skipped: ${escapeCell(reason)}`, escapeCell(name), '', '', '', '', '', '']),
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
  const baseline = durationNs(row.baseline);
  const candidate = durationNs(row.candidate);
  const difference = baseline === undefined || candidate === undefined ? '' : milliseconds(candidate - baseline, true);
  return [status, escapeCell(row.name), row.baseline, row.candidate, difference, signed(row.delta), row.p, row.ci];
}

function table(body: readonly (readonly string[])[]): readonly string[] {
  const header = ['status', 'bench', 'baseline', 'candidate', 'Δ time', 'Δ p50', 'p', '95% CI'];
  const row = (values: readonly string[]) => `| ${values.join(' | ')} |`;
  return [row(header), row(header.map(() => '---')), ...body.map(row)];
}

/** Summarizes only comparable rows; a workload median is not a frame time or an application-weighted score. */
function latencyDistribution(rows: readonly LabsRow[]): readonly string[] {
  const timings = rows.flatMap((row) => {
    const baseline = durationNs(row.baseline);
    const candidate = durationNs(row.candidate);
    return baseline === undefined || candidate === undefined ? [] : [{ row, baseline, candidate }];
  });
  if (timings.length === 0) return [];
  const baselineTimes = timings.map((timing) => timing.baseline);
  const candidateTimes = timings.map((timing) => timing.candidate);
  const lines = [
    `Latency distribution across ${timings.length} comparable workload p50s. Each workload counts once; these are not frame times.`,
    '',
    '| statistic | baseline | candidate |',
    '| --- | ---: | ---: |',
    `| Median workload p50 | ${milliseconds(median(baselineTimes))} | ${milliseconds(median(candidateTimes))} |`,
    ...[1, 2, 3].map(
      (limit) =>
        `| Workloads ≤${String(limit)} ms | ${baselineTimes.filter((time) => time <= limit * 1e6).length} | ${candidateTimes.filter((time) => time <= limit * 1e6).length} |`,
    ),
    `| Workloads >3 ms | ${baselineTimes.filter((time) => time > 3e6).length} | ${candidateTimes.filter((time) => time > 3e6).length} |`,
    '',
    'Largest candidate workloads (including neutral results):',
    '',
    '| workload | baseline | candidate | Δ time |',
    '| --- | ---: | ---: | ---: |',
    ...timings
      .sort((left, right) => right.candidate - left.candidate)
      .slice(0, 5)
      .map(
        ({ row, baseline, candidate }) =>
          `| ${escapeCell(row.name)} | ${row.baseline} | ${row.candidate} | ${milliseconds(candidate - baseline, true)} |`,
      ),
    '',
  ];
  return lines;
}

function durationNs(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(ns|µs|us|ms|s)$/u.exec(value);
  if (match === null) return undefined;
  const scale: Readonly<Record<string, number>> = { ns: 1, µs: 1e3, us: 1e3, ms: 1e6, s: 1e9 };
  const duration = Number(match[1]) * scale[match[2]!]!;
  return Number.isFinite(duration) ? duration : undefined;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
}

function milliseconds(nanoseconds: number, includeSign = false): string {
  const digits = nanoseconds !== 0 && Math.abs(nanoseconds) < 1000 ? 6 : 3;
  return `${includeSign && nanoseconds > 0 ? '+' : ''}${(nanoseconds / 1e6).toFixed(digits)}ms`;
}

const plotWidth = 31;
/** The name column fits the longest name between these bounds; longer names are shortened in the middle. */
const plotNameWidths = { min: 24, max: 60 } as const;
/** The axis never reaches past this, so one noisy bench cannot flatten the others; its interval ends in an arrow. */
const plotLimitCap = 50;
/** GitHub colours `-` lines red and `+` lines green inside a diff block, so the prefix carries the verdict. */
const plotPrefix: Readonly<Record<LabsRowStatus, string>> = { slower: '-', faster: '+', neutral: ' ' };

/**
 * A forest plot in a `diff` block, like the Labs terminal report: each bench's Δ p50 (●) inside its 95% confidence
 * interval (├─┤), against a zero line, with p and Labs' baseline and candidate sparklines. GitHub renders slower rows
 * red and faster rows green; neutral rows stay plain. Plain text, so it renders for fork pull requests too.
 */
function forestPlot(rows: readonly LabsRow[]): readonly string[] {
  const intervals = rows.map((row) => interval(row));
  const extent = Math.max(...intervals.flatMap(([low, high], index) => [low, high, rows[index]!.delta].map(Math.abs)));
  const limit = Math.max(5, Math.ceil(Math.min(extent, plotLimitCap) / 5) * 5);
  const column = (value: number) =>
    Math.round(((Math.max(-limit, Math.min(limit, value)) + limit) / (2 * limit)) * (plotWidth - 1));
  const zero = column(0);
  const sparks = rows.some((row) => row.baselineSpark !== undefined);
  const sparkWidth = Math.max(8, ...rows.map((row) => row.baselineSpark?.length ?? 0));
  const prefix = sharedWordPrefix(rows.map((row) => row.name));
  const label = (name: string) => (prefix === '' ? name : `…${name.slice(prefix.length)}`);
  const nameWidth = Math.min(
    plotNameWidths.max,
    Math.max(plotNameWidths.min, ...rows.map((row) => label(row.name).replace(/\s+/gu, ' ').trim().length)),
  );
  const indent = ' '.repeat(nameWidth + 2);
  const header = [
    `  ${indent}${'faster ◀'.padEnd(zero)}┊${'▶ slower'.padStart(plotWidth - zero - 1)}`,
    '    Δ p50      p',
    ...(sparks ? [`  ${'baseline'.padEnd(sparkWidth)} candidate`] : []),
  ].join('');
  const body = rows.map((row, index) => {
    const [low, high] = intervals[index]!;
    const track: string[] = Array.from({ length: plotWidth }, (_, at) => (at === zero ? '┊' : ' '));
    const from = column(low);
    const to = column(high);
    for (let at = from; at <= to; at += 1) track[at] = at === zero ? '┼' : '─';
    // Anything past the capped axis draws as an arrow at that edge, so it never reads as the edge value.
    if (low >= -limit && low <= limit) track[from] = '├';
    if (high >= -limit && high <= limit) track[to] = '┤';
    if (low < -limit) track[0] = '◀';
    if (high > limit) track[plotWidth - 1] = '▶';
    if (Math.abs(row.delta) <= limit) track[column(row.delta)] = '●';
    const distribution = sparks ? `  ${(row.baselineSpark ?? '').padEnd(sparkWidth)} ${row.candidateSpark ?? ''}` : '';
    return `${plotPrefix[row.status]} ${fit(label(row.name), nameWidth)}  ${track.join('')}  ${signed(row.delta).padStart(7)}  ${row.p.padStart(5)}${distribution}`.trimEnd();
  });
  const axis = Array.from({ length: plotWidth }, (_, at) =>
    at === 0 ? '└' : at === plotWidth - 1 ? '┘' : at === zero ? '┴' : '─',
  );
  const ticks = `${`-${String(limit)}%`.padEnd(zero)}0${`+${String(limit)}%`.padStart(plotWidth - zero - 1)}`;
  return [
    ...(prefix === '' ? [] : [`Every bench below starts with “${prefix.trimEnd()}”.`, '']),
    '```diff',
    header,
    ...body,
    `  ${indent}${axis.join('')}`,
    `  ${indent}${ticks}`,
    '```',
  ];
}

/** The 95% CI as numbers, from Labs' `-13.2..-8.1%` form; a missing or unreadable interval collapses to the point. */
function interval(row: LabsRow): readonly [number, number] {
  const match = /^([+-]?[\d.]+)\.\.([+-]?[\d.]+)%$/u.exec(row.ci);
  if (match === null) return [row.delta, row.delta];
  const low = Number(match[1]);
  const high = Number(match[2]);
  return Number.isFinite(low) && Number.isFinite(high)
    ? [Math.min(low, high), Math.max(low, high)]
    : [row.delta, row.delta];
}

/** The leading whole words every name shares, when there are several names and the words are worth hoisting. */
function sharedWordPrefix(names: readonly string[]): string {
  if (names.length < 2) return '';
  const words = names.map((name) => name.split(' '));
  let shared = 0;
  while (words.every((list) => list.length > shared + 1 && list[shared] === words[0]![shared])) shared += 1;
  const prefix = words[0]!.slice(0, shared).join(' ');
  return prefix.length >= 12 ? `${prefix} ` : '';
}

/** Bench names often share a long prefix, so a long name keeps its start and its distinguishing end. */
function fit(name: string, width: number): string {
  const flat = name.replace(/\s+/gu, ' ').trim();
  if (flat.length <= width) return flat.padEnd(width);
  const head = Math.ceil((width - 1) * 0.55);
  return `${flat.slice(0, head).trimEnd()}…${flat.slice(flat.length - (width - 1 - head)).trimStart()}`.padEnd(width);
}

function escapeCell(value: string): string {
  return value.replace(/\|/gu, '\\|');
}

function signed(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
}
