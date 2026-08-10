#!/usr/bin/env node

import { runCli } from '../dist/node/cli.js';

process.exitCode = await runCli(process.argv.slice(2));
