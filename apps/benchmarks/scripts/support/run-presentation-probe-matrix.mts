import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export interface PresentationProbeCase {
  readonly backend: 'webgpu' | 'webgl2';
  readonly technique?: 'bitmap' | 'mtsdf' | 'slug';
}

export interface PresentationProbeMatrixOptions {
  readonly cases: readonly PresentationProbeCase[];
  readonly label: string;
  readonly script: URL;
}

export async function runPresentationProbeMatrix(options: PresentationProbeMatrixOptions): Promise<void> {
  for (const probeCase of options.cases) {
    const environment = {
      ...process.env,
      PRESENTATION_BACKEND: probeCase.backend,
      ...(probeCase.technique === undefined ? {} : { PRESENTATION_TECHNIQUE: probeCase.technique }),
    };
    const description = [probeCase.backend, probeCase.technique].filter((value) => value !== undefined).join(' / ');
    console.log(`presentation-probe-case ${options.label}: ${description}`);
    await runPresentationProbe(options.script, environment, `${options.label}: ${description}`);
  }
}

async function runPresentationProbe(script: URL, environment: NodeJS.ProcessEnv, description: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(script)], {
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${description} exited with ${exitCode === null ? `signal ${signal ?? 'unknown'}` : `status ${String(exitCode)}`}`,
        ),
      );
    });
  });
}
