#!/usr/bin/env node

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const logPath = args.find((arg) => !arg.startsWith('--'));
if (logPath === undefined) {
  console.error('usage: read-log.mjs <append-only-log> [--delta] [--lines n] [--bytes n] [--state path]');
  process.exit(2);
}

const path = resolve(logPath);
const statePath = resolve(value('state', join(dirname(path), `.${path.split('/').pop()}.cursor.json`)));
const maxLines = Number(value('lines', '120'));
const maxBytes = Number(value('bytes', '24000'));
const delta = args.includes('--delta');

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.name !== 'SyntaxError') throw error;
    return { identity: '', offset: 0, size: 0 };
  }
}

function readLog() {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return { identity: '', text: '', offset: 0, size: 0 };
    throw error;
  }
  const state = loadState();
  const identity = `${stat.dev}:${stat.ino}`;
  const offset = delta && identity === state.identity && stat.size >= state.size ? state.offset : 0;
  const bytes = readFileSync(path);
  return { identity, text: bytes.subarray(offset).toString('utf8'), offset: bytes.length, size: stat.size };
}

const result = readLog();
const lines = result.text.split('\n').filter(Boolean);
const shown = lines.slice(-maxLines).join('\n');
const encoded = Buffer.from(shown, 'utf8');
const output = encoded.length > maxBytes ? encoded.subarray(encoded.length - maxBytes).toString('utf8') : shown;
if (output.length > 0) process.stdout.write(`${output}\n`);
if (delta) writeFileSync(statePath, JSON.stringify({ identity: result.identity, offset: result.offset, size: result.size }));
