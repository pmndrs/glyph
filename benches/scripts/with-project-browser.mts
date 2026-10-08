/* @workflow {
  "name": "benchmark:with-browser",
  "summary": "Run a command with Vitexec connected to the project-selected Chromium instead of downloading a browser.",
  "requirements": "Workspace dependencies and the selected Chromium executable. Pass the command and its arguments.",
  "writes": "Command-owned outputs; the browser server closes when the command exits."
} */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { projectChromiumLaunchOptions } from './support/project-chromium.mts';

const commandArguments = process.argv.slice(2);
if (commandArguments[0] === '--') commandArguments.shift();
const [command, ...args] = commandArguments;
if (command === undefined) throw new Error('Pass a command to run with the project browser');
const server = await chromium.launchServer(projectChromiumLaunchOptions({ headless: true }));
try {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, VITEXEC_BROWSER_WS_ENDPOINT: server.wsEndpoint() },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? String(code)}`));
    });
  });
} finally {
  await server.close();
}
