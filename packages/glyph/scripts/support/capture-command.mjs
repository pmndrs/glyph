import { spawn } from 'node:child_process';

export function captureCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
    });
    if (options.input !== undefined) {
      child.stdin.on('error', reject);
      child.stdin.end(options.input);
    }
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}
