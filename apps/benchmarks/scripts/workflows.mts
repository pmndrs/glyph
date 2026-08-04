import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Workflow {
  readonly args?: readonly string[];
  readonly name: string;
  readonly requirements: string;
  readonly runner?: 'node' | 'vitexec';
  readonly summary: string;
  readonly writes: string;
}

interface IndexedWorkflow extends Workflow {
  readonly cwd: string;
  readonly file: string;
}

const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const roots = [
  'apps/benchmarks/scripts',
  'apps/benchmarks/vitexec',
  'packages/font-baker/scripts',
  'packages/text/scripts',
];
const workflowPattern = /\/\* @workflow\s+(\{[\s\S]*?\})\s+\*\//g;

const workflows = await indexWorkflows();
const [operation = 'list', workflowName, ...forwardedArguments] = process.argv.slice(2);

if (operation === 'list' || operation === '--help' || operation === 'help') {
  printWorkflows(workflowName);
} else if (operation === 'show') {
  if (workflowName === undefined) fail('scripts show requires a workflow name');
  printWorkflow(requireWorkflow(workflowName));
} else if (operation === 'run') {
  if (workflowName === undefined) fail('scripts run requires a workflow name');
  await runWorkflow(requireWorkflow(workflowName), forwardedArguments);
} else {
  fail(`Unknown scripts operation: ${operation}`);
}

async function indexWorkflows(): Promise<readonly IndexedWorkflow[]> {
  const indexed: IndexedWorkflow[] = [];
  for (const root of roots) {
    for (const file of await sourceFiles(resolve(workspaceRoot, root))) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(workflowPattern)) {
        const parsed: unknown = JSON.parse(match[1]!);
        const workflow = validateWorkflow(parsed, relative(workspaceRoot, file));
        indexed.push({ ...workflow, cwd: await packageRoot(file), file });
      }
    }
  }
  indexed.sort((left, right) => left.name.localeCompare(right.name));
  const names = new Set<string>();
  for (const workflow of indexed) {
    if (names.has(workflow.name)) fail(`Duplicate workflow name: ${workflow.name}`);
    names.add(workflow.name);
  }
  return indexed;
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (['.mjs', '.mts', '.ts'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

async function packageRoot(file: string): Promise<string> {
  let directory = dirname(file);
  while (directory !== workspaceRoot) {
    try {
      const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as unknown;
      if (isObject(manifest)) return directory;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    directory = dirname(directory);
  }
  return workspaceRoot;
}

function validateWorkflow(value: unknown, file: string): Workflow {
  if (!isObject(value)) fail(`Invalid @workflow metadata in ${file}`);
  const { args, name, requirements, runner, summary, writes } = value;
  if (
    typeof name !== 'string' ||
    !/^[a-z0-9-]+(?::[a-z0-9-]+)+$/.test(name) ||
    typeof requirements !== 'string' ||
    typeof summary !== 'string' ||
    typeof writes !== 'string' ||
    (runner !== undefined && runner !== 'node' && runner !== 'vitexec') ||
    (args !== undefined && (!Array.isArray(args) || !args.every((argument) => typeof argument === 'string')))
  ) {
    fail(`Invalid @workflow metadata in ${file}`);
  }
  return {
    name,
    requirements,
    summary,
    writes,
    ...(args === undefined ? {} : { args: args as readonly string[] }),
    ...(runner === undefined ? {} : { runner }),
  };
}

function printWorkflows(query?: string): void {
  const selected = query === undefined ? workflows : workflows.filter((workflow) => workflow.name.includes(query));
  if (selected.length === 0) fail(`No workflows match: ${String(query)}`);
  process.stdout.write('Specialized maintenance workflows\n\n');
  for (const workflow of selected) {
    process.stdout.write(`${workflow.name}\n  ${workflow.summary}\n`);
  }
  process.stdout.write('\nUse `pnpm scripts show <name>` for requirements and writes.\n');
  process.stdout.write('Use `pnpm scripts run <name> -- [arguments]` to execute one.\n');
}

function printWorkflow(workflow: IndexedWorkflow): void {
  process.stdout.write(`${workflow.name}\n\n`);
  process.stdout.write(`${workflow.summary}\n\n`);
  process.stdout.write(`Usage: pnpm scripts run ${workflow.name} -- [arguments]\n`);
  process.stdout.write(`Requires: ${workflow.requirements}\n`);
  process.stdout.write(`Writes: ${workflow.writes}\n`);
  process.stdout.write(`Source: ${relative(workspaceRoot, workflow.file)}\n`);
}

async function runWorkflow(workflow: IndexedWorkflow, extraArguments: readonly string[]): Promise<void> {
  const runner = workflow.runner ?? (workflow.file.endsWith('.probe.ts') ? 'vitexec' : 'node');
  const executable =
    runner === 'node'
      ? process.execPath
      : resolve(
          workspaceRoot,
          `apps/benchmarks/node_modules/.bin/${process.platform === 'win32' ? 'vitexec.CMD' : 'vitexec'}`,
        );
  const file = runner === 'node' ? workflow.file : relative(workflow.cwd, workflow.file);
  const commandArguments =
    runner === 'node'
      ? [file, ...(workflow.args ?? []), ...extraArguments]
      : [...(workflow.args ?? []), file, ...extraArguments];
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(executable, commandArguments, { cwd: workflow.cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${workflow.name} exited with ${String(code)}`));
    });
  });
}

function requireWorkflow(candidateName: string): IndexedWorkflow {
  const workflow = workflows.find((candidate) => candidate.name === candidateName);
  if (workflow === undefined) fail(`Unknown workflow: ${candidateName}`);
  return workflow;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isObject(error) && error.code === 'ENOENT';
}

function fail(message: string): never {
  throw new Error(`${message}; run pnpm scripts list`);
}
