#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = { model: 'opus', effort: 'high' };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      fail(`Expected a value after ${flag ?? 'argument'}`);
    }
    if (flag === '--name') options.name = value;
    else if (flag === '--prompt-file') options.promptFile = resolve(value);
    else if (flag === '--model') options.model = value;
    else if (flag === '--effort') options.effort = value;
    else fail(`Unknown option: ${flag}`);
    index += 1;
  }

  if (!options.name) fail('Missing required --name');
  if (!options.promptFile) fail('Missing required --prompt-file');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.name)) {
    fail('--name must contain lowercase letters, digits, or hyphens');
  }
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) {
    fail('--effort must be low, medium, high, xhigh, or max');
  }
  return options;
}

function gitOutput(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) fail(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function renderAssistantMessage(event) {
  if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) return;
  for (const block of event.message.content) {
    if (block.type === 'text' && block.text) process.stdout.write(`${block.text}\n`);
    if (block.type === 'tool_use') process.stdout.write(`[tool] ${block.name}\n`);
  }
}

const options = parseArguments(process.argv.slice(2));
const repository = gitOutput(['rev-parse', '--show-toplevel']);
const commit = gitOutput(['rev-parse', 'HEAD']);
const prompt = readFileSync(options.promptFile, 'utf8');
const startedAt = new Date();
const timestamp = startedAt.toISOString().replaceAll(':', '').replaceAll('.', '-');
const runDirectory = resolve(repository, '.cache', 'claude-review', `${timestamp}-${options.name}`);
mkdirSync(runDirectory, { recursive: true });

const promptPath = resolve(runDirectory, 'prompt.md');
const eventsPath = resolve(runDirectory, 'events.jsonl');
const reportPath = resolve(runDirectory, 'report.md');
const stderrPath = resolve(runDirectory, 'stderr.log');
const metadataPath = resolve(runDirectory, 'run.json');
writeFileSync(promptPath, prompt);

const metadata = {
  schemaVersion: 1,
  status: 'running',
  name: options.name,
  repository,
  commit,
  model: options.model,
  effort: options.effort,
  promptFile: basename(promptPath),
  startedAt: startedAt.toISOString(),
};
writeJson(metadataPath, metadata);

process.stdout.write(`Claude review: ${options.name}\n`);
process.stdout.write(`Trace: ${runDirectory}\n`);

const child = spawn(
  'claude',
  [
    '-p',
    '--model',
    options.model,
    '--effort',
    options.effort,
    '--permission-mode',
    'plan',
    '--tools',
    'Read,Grep,Glob,Bash',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
  ],
  { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] },
);
child.stdin.end(prompt);

const events = createWriteStream(eventsPath, { flags: 'wx' });
const diagnostics = createWriteStream(stderrPath, { flags: 'wx' });
let resultEvent;
let parseFailure;
let resolvedModel;
let claudeCodeVersion;

createInterface({ input: child.stdout }).on('line', (line) => {
  events.write(`${line}\n`);
  try {
    const event = JSON.parse(line);
    renderAssistantMessage(event);
    if (event.type === 'system' && event.subtype === 'init') {
      resolvedModel = event.model;
      claudeCodeVersion = event.claude_code_version;
    }
    if (event.type === 'result') resultEvent = event;
  } catch (error) {
    parseFailure = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[unparsed event] ${line}\n`);
  }
});

child.stderr.on('data', (chunk) => {
  diagnostics.write(chunk);
  process.stderr.write(chunk);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  process.stderr.write(`Unable to launch Claude: ${error.message}\n`);
});

child.on('close', (exitCode, signal) => {
  events.end();
  diagnostics.end();
  const completedAt = new Date();
  const report = typeof resultEvent?.result === 'string' ? resultEvent.result : '';
  writeFileSync(reportPath, report);
  writeJson(metadataPath, {
    ...metadata,
    status: exitCode === 0 && report ? 'complete' : 'failed',
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    exitCode,
    signal,
    sessionId: resultEvent?.session_id,
    resolvedModel,
    claudeCodeVersion,
    stopReason: resultEvent?.stop_reason,
    costUsd: resultEvent?.total_cost_usd,
    usage: resultEvent?.usage,
    parseFailure,
    reportFile: basename(reportPath),
  });

  if (!report) process.stderr.write('Claude did not emit a final report. Inspect events.jsonl and stderr.log.\n');
  process.stdout.write(`Review ${exitCode === 0 && report ? 'complete' : 'failed'}: ${runDirectory}\n`);
  process.exitCode = exitCode ?? 1;
});
