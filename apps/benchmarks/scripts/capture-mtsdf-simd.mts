import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const textRoot = fileURLToPath(new URL('../../../packages/text', import.meta.url));
const vitexec = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url));

await run('pnpm', ['--filter', '@pmndrs/text', 'measure:mtsdf-simd', '--retain-artifacts']);

const browserRoot = `/@fs${textRoot}`;
const snippet = `
const root = ${JSON.stringify(browserRoot)}
const { createMtsdfGenerator } = await import(root + "/dist/internal/mtsdf-generator.js")
const { mtsdfOracleCases } = await import(root + "/tests/fixtures/mtsdf-oracle-cases.mjs")
const ids = ["scalar", "auto-vectorized", "explicit-simd128"]
const generators = []
for (const id of ids) {
  const response = await fetch(root + "/dist/evidence/mtsdf-simd/" + id + ".wasm")
  if (!response.ok) throw new Error(id + " fetch " + response.status)
  generators.push(await createMtsdfGenerator(await response.arrayBuffer()))
}
const samples = ids.map(() => [])
for (let pass = 0; pass < 24; pass += 1) {
  const order = pass % 2 === 0 ? [0, 1, 2] : [2, 1, 0]
  for (const index of order) {
    const outputs = new Array(mtsdfOracleCases.length)
    const start = performance.now()
    for (let caseIndex = 0; caseIndex < mtsdfOracleCases.length; caseIndex += 1) {
      outputs[caseIndex] = generators[index].generate(mtsdfOracleCases[caseIndex].request).rgba
    }
    samples[index].push(performance.now() - start)
  }
}
for (let index = 0; index < ids.length; index += 1) {
  for (const testCase of mtsdfOracleCases) {
    const bytes = generators[index].generate(testCase.request).rgba
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
    const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    if (hash !== testCase.candidateSha256) throw new Error(ids[index] + " " + testCase.id + " hash")
  }
  const warm = samples[index].slice(4).sort((left, right) => left - right)
  console.log("mtsdf-simd", JSON.stringify({
    id: ids[index],
    exactOracleHashes: true,
    medianMilliseconds: warm[Math.floor(warm.length / 2)],
    samples: warm,
  }))
}
`;

await run(vitexec, ['--gpu', '--timeout', '120', snippet], appRoot);

function run(command: string, args: readonly string[], cwd = workspaceRoot): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${String(code ?? signal)}`));
    });
  });
}
