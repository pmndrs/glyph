import canonicalFontUrl from '../../../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url';
import type { BenchmarkTarget } from '../../contracts';
import { loadDirectWasmDependencies, type DirectFontBaker } from '../shared/direct-wasm';

/** The only throughput target that invokes the direct font-baker ABI. */
let baker: DirectFontBaker | undefined;
let canonicalFontBytes: Uint8Array | undefined;

const bakerTarget: BenchmarkTarget = {
  id: 'font-baker',
  label: 'Rust font baker',
  detail: 'Wasm · direct memory ABI',
  color: 'green',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm']),
  status: () => 'ready',
  load: async () => {
    if (baker !== undefined && canonicalFontBytes !== undefined) return;
    const { bakerWasmUrl, createFontBaker } = await loadDirectWasmDependencies();
    const [wasmResponse, fontResponse] = await Promise.all([fetch(bakerWasmUrl), fetch(canonicalFontUrl)]);
    if (!wasmResponse.ok) throw new Error(`Unable to load font baker Wasm (${wasmResponse.status})`);
    if (!fontResponse.ok) throw new Error(`Unable to load canonical font fixture (${fontResponse.status})`);
    const [wasm, font] = await Promise.all([wasmResponse.arrayBuffer(), fontResponse.arrayBuffer()]);
    baker = await createFontBaker(wasm);
    canonicalFontBytes = new Uint8Array(font);
  },
  run: async (input) => {
    if (baker === undefined || canonicalFontBytes === undefined) throw new Error('Font baker target was not loaded');
    const result = baker.bake({
      source: input.fontBytes ?? canonicalFontBytes,
      descriptor: { formatVersion: 0, fontFaceIndex: 0 },
    });
    const artifact = result.artifacts[0];
    if (artifact === undefined) throw new Error('Font baker returned no artifact');
    return { bytes: artifact.bytes.byteLength, hash: artifact.fingerprint };
  },
  dispose: async () => undefined,
};

export function createFontBakerMeasurementTargets(): readonly BenchmarkTarget[] {
  return [bakerTarget];
}
