#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { AnyRasterBakerModule, RasterBakePlan } from '../bake.js';
import { bakeFont, bakeProject, NodeBakeError, type NodeFontBakeReport, type ProjectBakeOptions } from './bake.js';

const run = promisify(execFile);

export interface CliIo {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}`);
    return 2;
  }
  if (parsed.help) {
    io.stdout.write(usage());
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
    if (error instanceof NodeBakeError) {
      io.stderr.write(`${error.code}: ${error.message}${error.path === undefined ? '' : ` (${error.path})`}\n`);
    } else {
      io.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    }
    return 1;
  }
}

interface ParsedArguments {
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
  readonly slug: boolean;
  readonly unicodes?: string;
  readonly check: boolean;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
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
  let slug = false;
  let unicodes: string | undefined;
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
      msdf = true;
    } else if (argument === '--slug') {
      slug = true;
    } else if (argument === '--unicodes') {
      unicodes = uniqueValue(unicodes, valueAfter(argv, ++index, argument), argument);
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
    unicodes !== undefined ||
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
            slug,
            ...(unicodes === undefined ? {} : { unicodes }),
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

async function bakeDirect(options: DirectBakeArguments): Promise<NodeFontBakeReport> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pmndrs-text-bake-'));
  try {
    const input = await subsetInput(options, temporaryDirectory);
    const output = options.check ? join(temporaryDirectory, 'checked.font.glb') : options.output;
    const report = await bakeFont({
      input,
      output,
      font: { fontFaceIndex: options.unicodes === undefined ? options.fontFaceIndex : 0 },
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

async function subsetInput(options: DirectBakeArguments, temporaryDirectory: string): Promise<string> {
  if (options.unicodes === undefined) return options.input;
  const output = join(temporaryDirectory, 'subset.ttf');
  try {
    await run('hb-subset', [
      options.input,
      `--face-index=${options.fontFaceIndex}`,
      `--unicodes=${options.unicodes}`,
      `--output-file=${output}`,
    ]);
  } catch (error) {
    throw new NodeBakeError(
      'SUBSET_FAILED',
      `hb-subset failed: ${error instanceof Error ? error.message : String(error)}`,
      options.input,
    );
  }
  return output;
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
    rasters.push({ baker: msdfBaker, packaging, options: undefined });
  }
  if (options.slug) {
    const { slugBaker } = await import('../bakers/slug.js');
    rasters.push({ baker: slugBaker, packaging, options: undefined });
  }
  return rasters;
}

function valueAfter(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('-')) {
    throw new TypeError(`${option} requires a value`);
  }
  return value;
}

function usage(): string {
  return `Usage: pmndrs-text-bake [options]

Options:
  --input <path>         Bake one known local font instead of project discovery
  --output <path>        Output GLB for direct font baking
  --font-face-index <n>  Collection face for direct baking (default: 0)
  --unicodes <set>       Subset the shaping font through hb-subset before baking
  --bitmap <ppem,...>    Embed Bitmap at the listed ppem strikes
  --msdf                 Embed the default MSDF raster
  --slug                 Embed the default Slug raster
  --check                Rebuild a direct font and require byte-identical output
  --project-root <path>  Project root (default: current directory)
  --entry <path>         Restrict discovery to an entry; repeatable
  --asset-root <path>    Local asset root; repeatable (default: public)
  --output-root <path>   Mirror asset-relative outputs under this directory
  --json                 Print the complete machine-readable report
  -h, --help             Show this help
`;
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
