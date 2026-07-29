#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { bakeProject, NodeBakeError, type ProjectBakeOptions } from './bake.js';

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
    const report = await bakeProject(parsed.options);
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
  readonly options: ProjectBakeOptions;
  readonly json: boolean;
  readonly help: boolean;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  let projectRoot: string | undefined;
  let outputRoot: string | undefined;
  const entries: string[] = [];
  const assetRoots: string[] = [];
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
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  return {
    options: {
      ...(projectRoot === undefined ? {} : { projectRoot }),
      ...(outputRoot === undefined ? {} : { outputRoot }),
      ...(entries.length === 0 ? {} : { entries }),
      ...(assetRoots.length === 0 ? {} : { assetRoots }),
    },
    json,
    help,
  };
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
