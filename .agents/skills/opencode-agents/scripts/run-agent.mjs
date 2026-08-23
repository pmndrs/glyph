#!/usr/bin/env node
// Launch an opencode agent that survives an unavailable provider.
//
// The free tiers are under load test, so `Upstream request failed: Endpoint is unavailable` and
// `Service Unavailable` are the steady state rather than the exception: 43 of them in one night,
// twenty inside a single fifteen-minute window. A run that dies to one has lost nothing -- the
// session persists -- so the launcher resumes it by id with metered backoff instead of restarting.

import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const briefPath = flag('brief');
const cwd = flag('cwd', process.cwd());
const model = flag('model', 'opencode/x-preview-f-free');
const variant = flag('variant', 'high');
const traceDir = flag('trace', join(cwd, '.cache', 'opencode-agents'));
const maxAttempts = Number(flag('attempts', '8'));
const ceilingMs = Number(flag('ceiling', '120000'));

if (briefPath === undefined) {
  console.error('usage: run-agent.mjs --brief <file> [--cwd <dir>] [--model <id>] [--attempts n]');
  process.exit(2);
}

mkdirSync(traceDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const tracePath = join(traceDir, `${stamp}.jsonl`);
const brief = readFileSync(briefPath, 'utf8');

/** The provider is unavailable, not the work invalid: resume rather than restart. */
const isTransient = (text) =>
  /Endpoint is unavailable|Service Unavailable|AI_APICallError|ECONNRESET|socket hang up|fetch failed/i.test(text);

function runOnce(sessionId) {
  return new Promise((resolve) => {
    const argv = ['run', '--pure', '--auto', '--variant', variant, '--format', 'json', '-m', model];
    if (sessionId !== undefined) argv.push('--session', sessionId);
    argv.push(sessionId === undefined ? brief : RESUME_PROMPT);
    const child = spawn('opencode', argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      appendFileSync(tracePath, chunk);
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
      appendFileSync(tracePath, chunk);
    });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

const RESUME_PROMPT =
  'Continue where you left off. Your session was interrupted by a provider outage, not cancelled. ' +
  'Report what you had already completed, then finish the remaining work and commit it.';

/** The session id is the handle that makes a resume possible, so recover it from the first stream. */
function sessionFrom(text) {
  return /"sessionID":"(ses_[A-Za-z0-9]+)"/.exec(text)?.[1];
}

let sessionId;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const { code, out, err } = await runOnce(sessionId);
  sessionId ??= sessionFrom(out);
  if (code === 0) {
    console.log(`agent finished on attempt ${attempt}; trace ${tracePath}`);
    process.exit(0);
  }
  const blob = `${out}\n${err}`;
  if (!isTransient(blob)) {
    console.error(`agent failed for a reason that is not a provider outage (exit ${code}); trace ${tracePath}`);
    process.exit(code ?? 1);
  }
  // Metered: double each time, capped, so a fifteen-minute outage is ridden out rather than hammered.
  const waitMs = Math.min(ceilingMs, 5000 * 2 ** (attempt - 1));
  console.warn(
    `attempt ${attempt} hit an unavailable provider; ${sessionId === undefined ? 'restarting' : `resuming ${sessionId}`} in ${waitMs / 1000}s`,
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
console.error(`agent still unavailable after ${maxAttempts} attempts; trace ${tracePath}`);
process.exit(1);
