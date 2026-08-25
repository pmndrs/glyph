#!/usr/bin/env node

import type { MsdfOptions } from '../internal/msdf-contract.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AnyRasterBakerModule, RasterBakePlan } from '../bake.js';
import type { UnicodeRange } from '../font-baker/index.js';
import { normalizeUnicodeRanges } from '../internal/font-selection.js';
import {
  bakeFont,
  bakeProject,
  inspectFont,
  NodeBakeError,
  type NodeFontBakeReport,
  type ProjectBakeOptions,
} from './bake.js';

export interface CliIo {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const [command, ...commandArguments] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    io.stdout.write(topLevelUsage());
    return 0;
  }
  if (command === '--version' || command === '-v') {
    try {
      io.stdout.write(`@pmndrs/glyph ${await packageVersion()}\n`);
      return 0;
    } catch (error) {
      writeFailure(io, error);
      return 1;
    }
  }
  if (command === 'glyphs') return runGlyphsCommand(commandArguments, io);
  if (command !== 'bake') {
    io.stderr.write(`Unknown command: ${command}\n\n${topLevelUsage()}`);
    return 2;
  }

  let parsed: ParsedBakeArguments;
  try {
    parsed = parseBakeArguments(commandArguments);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${bakeUsage()}`);
    return 2;
  }
  if (parsed.help) {
    io.stdout.write(bakeUsage());
    return 0;
  }
  try {
    if (parsed.direct !== undefined) {
      const report = await bakeDirect(parsed.direct);
      if (parsed.json) io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        io.stdout.write(`${parsed.direct.input} -> ${parsed.direct.output}\n`);
        io.stdout.write(`Baked 1 font in ${report.execution.timingsMs.total.toFixed(2)} ms.\n`);
      }
      return 0;
    }
    const report = await bakeProject(parsed.project);
    if (parsed.json) {
      io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      for (const mapping of report.mappings) {
        io.stdout.write(`${mapping.publicPathname} -> ${mapping.outputFile}\n`);
      }
      for (const diagnostic of report.diagnostics) {
        io.stderr.write(`${diagnostic.code}: ${diagnostic.message} (${diagnostic.sourceFile})\n`);
      }
      const total = report.fonts.reduce((sum, font) => sum + font.execution.timingsMs.total, 0);
      io.stdout.write(
        `Baked ${report.fonts.length} font${report.fonts.length === 1 ? '' : 's'} in ${total.toFixed(2)} ms.\n`,
      );
    }
    return report.diagnostics.length === 0 ? 0 : 1;
  } catch (error) {
    writeFailure(io, error);
    return 1;
  }
}

interface GlyphArguments {
  readonly input: string;
  readonly fontFaceIndex: number;
  readonly names: readonly string[];
  readonly json: boolean;
  readonly unicodeSet: boolean;
  readonly help: boolean;
}

interface GlyphRecord {
  readonly unicode: string;
  readonly codePoint: number;
  readonly glyphId: number;
  readonly name?: string;
}

async function runGlyphsCommand(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed: GlyphArguments;
  try {
    parsed = parseGlyphArguments(argv);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${glyphUsage()}`);
    return 2;
  }
  if (parsed.help) {
    io.stdout.write(glyphUsage());
    return 0;
  }
  try {
    const glyphs = await inspectGlyphs(parsed);
    if (parsed.json) {
      io.stdout.write(
        `${JSON.stringify({ input: parsed.input, fontFaceIndex: parsed.fontFaceIndex, glyphs }, null, 2)}\n`,
      );
    } else if (parsed.unicodeSet) {
      io.stdout.write(`${formatUnicodeSet(glyphs.map(({ codePoint }) => codePoint))}\n`);
    } else {
      for (const glyph of glyphs) {
        io.stdout.write(`${glyph.unicode}\t${glyph.glyphId}\t${glyph.name ?? '-'}\n`);
      }
    }
    return 0;
  } catch (error) {
    writeFailure(io, error);
    return 1;
  }
}

function parseGlyphArguments(argv: readonly string[]): GlyphArguments {
  let input: string | undefined;
  let fontFaceIndex = 0;
  let fontFaceIndexSet = false;
  const names: string[] = [];
  let json = false;
  let unicodeSet = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--font-face-index') {
      if (fontFaceIndexSet) throw new TypeError('--font-face-index may be provided only once');
      fontFaceIndexSet = true;
      fontFaceIndex = nonnegativeInteger(valueAfter(argv, ++index, argument), argument);
    } else if (argument === '--name') {
      names.push(valueAfter(argv, ++index, argument));
    } else if (argument === '--json') {
      json = true;
    } else if (argument === '--unicode-set') {
      unicodeSet = true;
    } else if (argument.startsWith('-')) {
      throw new TypeError(`Unknown glyphs argument: ${argument}`);
    } else {
      input = uniqueValue(input, argument, 'font input');
    }
  }
  if (json && unicodeSet) throw new TypeError('--json and --unicode-set cannot be combined');
  if (!help && input === undefined) throw new TypeError('glyph inspection requires a font input');
  return { input: input ?? '', fontFaceIndex, names, json, unicodeSet, help };
}

async function inspectGlyphs(options: GlyphArguments): Promise<readonly GlyphRecord[]> {
  let inspection;
  try {
    inspection = await inspectFont({ input: options.input, fontFaceIndex: options.fontFaceIndex });
  } catch (error) {
    if (error instanceof NodeBakeError) throw error;
    throw new NodeBakeError(
      'FONT_INSPECTION_FAILED',
      `font inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      options.input,
    );
  }
  const requestedNames = new Set(options.names);
  const foundNames = new Set<string>();
  const glyphs: GlyphRecord[] = [];
  for (const glyph of inspection.glyphs) {
    const { codePoint, glyphId, name } = glyph;
    if (requestedNames.size !== 0 && (name === undefined || !requestedNames.has(name))) continue;
    if (name !== undefined) foundNames.add(name);
    glyphs.push({
      unicode: formatCodePoint(codePoint),
      codePoint,
      glyphId,
      ...(name === undefined ? {} : { name }),
    });
  }
  const missing = options.names.filter((name) => !foundNames.has(name));
  if (missing.length !== 0) {
    throw new NodeBakeError(
      'GLYPH_NAME_NOT_FOUND',
      `font has no glyph name${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      options.input,
    );
  }
  return glyphs;
}

function formatUnicodeSet(codePoints: readonly number[]): string {
  if (codePoints.length === 0) return '';
  const sortedCodePoints = [...new Set(codePoints)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start = sortedCodePoints[0]!;
  let end = start;
  for (const codePoint of sortedCodePoints.slice(1)) {
    if (codePoint === end + 1) {
      end = codePoint;
      continue;
    }
    ranges.push(start === end ? formatCodePoint(start) : `${formatCodePoint(start)}-${formatCodePoint(end)}`);
    start = codePoint;
    end = codePoint;
  }
  ranges.push(start === end ? formatCodePoint(start) : `${formatCodePoint(start)}-${formatCodePoint(end)}`);
  return ranges.join(',');
}

function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

interface ParsedBakeArguments {
  readonly project: ProjectBakeOptions;
  readonly direct?: DirectBakeArguments;
  readonly json: boolean;
  readonly help: boolean;
}

interface DirectBakeArguments {
  readonly input: string;
  readonly output: string;
  readonly fontFaceIndex: number;
  readonly bitmapStrikes?: readonly [number, ...number[]];
  readonly msdf: boolean;
  readonly msdfOptions?: MsdfOptions;
  readonly slug: boolean;
  readonly unicodeRanges?: readonly UnicodeRange[];
  readonly check: boolean;
}

function parseBakeArguments(argv: readonly string[]): ParsedBakeArguments {
  let projectRoot: string | undefined;
  let outputRoot: string | undefined;
  const entries: string[] = [];
  const assetRoots: string[] = [];
  let input: string | undefined;
  let output: string | undefined;
  let fontFaceIndex = 0;
  let fontFaceIndexSet = false;
  let bitmapStrikes: readonly [number, ...number[]] | undefined;
  let msdf = false;
  let msdfOptions: MsdfOptions | undefined;
  let slug = false;
  let unicodeRanges: readonly UnicodeRange[] | undefined;
  let check = false;
  let json = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--json') {
      json = true;
    } else if (argument === '--project-root') {
      projectRoot = valueAfter(argv, ++index, argument);
    } else if (argument === '--output-root') {
      outputRoot = valueAfter(argv, ++index, argument);
    } else if (argument === '--entry') {
      entries.push(valueAfter(argv, ++index, argument));
    } else if (argument === '--asset-root') {
      assetRoots.push(valueAfter(argv, ++index, argument));
    } else if (argument === '--input') {
      input = uniqueValue(input, valueAfter(argv, ++index, argument), argument);
    } else if (argument === '--output') {
      output = uniqueValue(output, valueAfter(argv, ++index, argument), argument);
    } else if (argument === '--font-face-index') {
      if (fontFaceIndexSet) throw new TypeError('--font-face-index may be provided only once');
      fontFaceIndexSet = true;
      fontFaceIndex = nonnegativeInteger(valueAfter(argv, ++index, argument), argument);
    } else if (argument === '--bitmap') {
      if (bitmapStrikes !== undefined) throw new TypeError('--bitmap may be provided only once');
      bitmapStrikes = bitmapStrikeList(valueAfter(argv, ++index, argument));
    } else if (argument === '--msdf') {
      if (msdf) throw new TypeError('--msdf may be provided only once');
      msdf = true;
      // The settings are optional and follow the flag, the way --bitmap's
      // strike list does. Anything beginning with a dash is the next flag, so a
      // bare --msdf keeps meaning "the defaults".
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('-')) {
        msdfOptions = parseMsdfOptions(argv[++index]!);
      }
    } else if (argument === '--slug') {
      slug = true;
    } else if (argument === '--unicodes') {
      if (unicodeRanges !== undefined) throw new TypeError('--unicodes may be provided only once');
      unicodeRanges = parseUnicodeSet(valueAfter(argv, ++index, argument));
    } else if (argument === '--check') {
      check = true;
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  const directSelected =
    input !== undefined ||
    output !== undefined ||
    bitmapStrikes !== undefined ||
    msdf ||
    slug ||
    unicodeRanges !== undefined ||
    check ||
    fontFaceIndexSet;
  const projectSelected =
    projectRoot !== undefined || outputRoot !== undefined || entries.length !== 0 || assetRoots.length !== 0;
  if (directSelected && projectSelected)
    throw new TypeError('direct font options cannot be mixed with project discovery');
  if (directSelected && (input === undefined || output === undefined)) {
    throw new TypeError('direct font baking requires both --input and --output');
  }
  return {
    project: {
      ...(projectRoot === undefined ? {} : { projectRoot }),
      ...(outputRoot === undefined ? {} : { outputRoot }),
      ...(entries.length === 0 ? {} : { entries }),
      ...(assetRoots.length === 0 ? {} : { assetRoots }),
    },
    ...(directSelected
      ? {
          direct: {
            input: input!,
            output: output!,
            fontFaceIndex,
            ...(bitmapStrikes === undefined ? {} : { bitmapStrikes }),
            msdf,
    ...(msdfOptions === undefined ? {} : { msdfOptions }),
            slug,
            ...(unicodeRanges === undefined ? {} : { unicodeRanges }),
            check,
          },
        }
      : {}),
    json,
    help,
  };
}

function uniqueValue(previous: string | undefined, value: string, option: string): string {
  if (previous !== undefined) throw new TypeError(`${option} may be provided only once`);
  return value;
}

function nonnegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(`${option} requires a nonnegative integer`);
  return parsed;
}

function bitmapStrikeList(value: string): readonly [number, ...number[]] {
  const strikes = value.split(',').map((part) => Number(part));
  if (strikes.length === 0 || strikes.some((strike) => !Number.isSafeInteger(strike) || strike <= 0)) {
    throw new TypeError('--bitmap requires a comma-separated list of positive integer ppem strikes');
  }
  return strikes as [number, ...number[]];
}

function parseUnicodeSet(value: string): readonly UnicodeRange[] {
  const ranges = value.split(',').map((part) => {
    const match = /^U\+([0-9A-Fa-f]{1,6})(?:-U\+?([0-9A-Fa-f]{1,6})|-([0-9A-Fa-f]{1,6}))?$/u.exec(part.trim());
    if (match === null) throw new TypeError('--unicodes requires comma-separated U+XXXX or U+XXXX-YYYY ranges');
    const start = Number.parseInt(match[1]!, 16);
    const end = Number.parseInt(match[2] ?? match[3] ?? match[1]!, 16);
    if (start > end || end > 0x10ffff) {
      throw new TypeError('--unicodes ranges must be ordered Unicode scalar values at or below U+10FFFF');
    }
    return { start, end };
  });
  return normalizeUnicodeRanges(ranges);
}

async function bakeDirect(options: DirectBakeArguments): Promise<NodeFontBakeReport> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'text-bake-'));
  try {
    const output = options.check ? join(temporaryDirectory, 'checked.font.glb') : options.output;
    const report = await bakeFont({
      input: options.input,
      output,
      font: { fontFaceIndex: options.fontFaceIndex },
      ...(options.unicodeRanges === undefined ? {} : { unicodeRanges: options.unicodeRanges }),
      rasters: await directRasterPlans(options),
    });
    if (options.check) {
      const [expected, actual] = await Promise.all([readFile(options.output), readFile(output)]);
      if (!expected.equals(actual)) {
        throw new NodeBakeError(
          'STALE_OUTPUT',
          'baked font is not byte-identical to the requested output',
          options.output,
        );
      }
    }
    return report;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function directRasterPlans(options: DirectBakeArguments): Promise<RasterBakePlan<AnyRasterBakerModule>[]> {
  const packaging = { artifact: 'embedded', pages: 'embedded' } as const;
  const rasters: RasterBakePlan<AnyRasterBakerModule>[] = [];
  if (options.bitmapStrikes !== undefined) {
    const { bitmapBaker } = await import('../bakers/bitmap.js');
    rasters.push({ baker: bitmapBaker, packaging, options: { strikes: options.bitmapStrikes } });
  }
  if (options.msdf) {
    const { msdfBaker } = await import('../bakers/msdf.js');
    rasters.push({ baker: msdfBaker, packaging, options: options.msdfOptions });
  }
  if (options.slug) {
    const { slugBaker } = await import('../bakers/slug.js');
    rasters.push({ baker: slugBaker, packaging, options: undefined });
  }
  return rasters;
}

/**
 * `em-size=32,pixel-range=6` — the technique's own settings, in the technique's
 * own terms.
 *
 * Atlas cost scales with the square of the em size, so a face set at small sizes
 * pays several times over for the default of 64 and has no way to say so.
 */
function parseMsdfOptions(value: string): MsdfOptions {
  const options: { emSize?: number; pixelRange?: number } = {};
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=');
    if (separator < 1) {
      throw new TypeError(`--msdf settings must be key=value pairs: ${entry}`);
    }
    const key = entry.slice(0, separator).trim();
    const raw = entry.slice(separator + 1).trim();
    if (key === 'em-size') options.emSize = positiveInteger(raw, 'em-size');
    else if (key === 'pixel-range') options.pixelRange = positiveInteger(raw, 'pixel-range');
    else throw new TypeError(`Unknown --msdf setting: ${key}`);
  }
  return options;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`--msdf ${label} must be a positive integer: ${value}`);
  }
  return parsed;
}

function valueAfter(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('-')) {
    throw new TypeError(`${option} requires a value`);
  }
  return value;
}

async function packageVersion(): Promise<string> {
  const value: unknown = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('version' in value)) {
    throw new TypeError('@pmndrs/glyph package metadata has no version');
  }
  const version = value.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new TypeError('@pmndrs/glyph package metadata has an invalid version');
  }
  return version;
}

function writeFailure(io: CliIo, error: unknown): void {
  if (error instanceof NodeBakeError) {
    io.stderr.write(`${error.code}: ${error.message}${error.path === undefined ? '' : ` (${error.path})`}\n`);
  } else {
    io.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  }
}

function topLevelUsage(): string {
  return `Usage: glyph <command> [options]

Portable font baking for @pmndrs/glyph.

Commands:
  bake                  Bake font shaping data and optional raster techniques
  glyphs <font>         List Unicode mappings and font-provided glyph names

Global options:
  -h, --help            Show this help
  -v, --version         Show the installed @pmndrs/glyph version

Run "glyph <command> --help" for command-specific options and examples.
`;
}

function glyphUsage(): string {
  return `Usage: glyph glyphs <font> [options]

List the font's Unicode mappings and surface glyph names retained in its post or
CFF data. Fonts without authored names still report exact glyph IDs.

Options:
  --font-face-index <n>  Collection face to inspect (default: 0)
  --name <glyph-name>    Select an exact font-provided glyph name; repeatable
  --json                 Emit structured Unicode, glyph ID, and name records
  --unicode-set          Emit a compressed set for glyph bake --unicodes
  -h, --help             Show this help

Examples:
  glyph glyphs fa-solid-900.ttf --name globe --json
  glyph glyphs fa-solid-900.ttf --name globe --name earth-americas --unicode-set
`;
}

function bakeUsage(): string {
  return `Usage:
  glyph bake [discovery options]
  glyph bake --input <font> --output <font.glb> [options]

Bake one known font directly, or discover defineFont() declarations in a project.
Direct options and discovery options cannot be mixed. With no bake options, discovery
scans the current project and writes beside each source asset.

Direct font options:
  --input <path>         Source TTF, OTF, TTC, or OTC font
  --output <path>        Output GLB containing shaping data and selected rasters
  --font-face-index <n>  Collection face to bake (default: 0)
  --unicodes <set>       Unicode set used to prepare a smaller source font
                        Example: U+0020-007E,U+00A0-00FF,U+4E00-9FFF
                        Selects code points, not raw glyph IDs

Raster options:
  --bitmap <ppem,...>    Embed Bitmap at positive integer ppem strikes (example: 16,32)
  --msdf [settings]      Embed the MSDF raster, optionally configured
                        Settings: em-size (default 64), pixel-range (default 8)
                        Example: --msdf em-size=32,pixel-range=6
  --slug                 Embed the default Slug raster
                        With none selected, emit a shaping-only GLB

Discovery options:
  --project-root <path>  Project root (default: current directory)
  --entry <path>         Restrict discovery to an entry; repeatable
  --asset-root <path>    Local asset root; repeatable (default: public)
  --output-root <path>   Mirror asset-relative outputs under this directory

Output options:
  --check                Rebuild in temporary storage and require byte-identical output
  --json                 Print the complete machine-readable bake report
  -h, --help             Show this help

Examples:
  glyph bake --input Inter-Regular.ttf --output inter.font.glb --bitmap 16,32 --msdf --slug
  glyph bake --input Inter-Regular.ttf --output inter-latin.font.glb --unicodes U+0020-007E --msdf
  glyph bake --input Inter-Regular.ttf --output inter-small.font.glb --msdf em-size=32
  glyph bake --project-root . --output-root public/generated
  glyph bake --input Inter-Regular.ttf --output inter.font.glb --msdf --check

`;
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
