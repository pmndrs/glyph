const WASM_URL_PREFIX = 'wasm://';
const GLYPH_PACKAGE_PATH = '/node_modules/@pmndrs/glyph/dist/';
const GLYPH_WORKSPACE_SOURCE_PATH = '/packages/glyph/src/';
const GLYPH_WORKSPACE_DIST_PATH = '/packages/glyph/dist/';

export type CpuProfileStage =
  | 'allocation'
  | 'benchmark-harness'
  | 'external-javascript'
  | 'gather'
  | 'host-runtime'
  | 'javascript'
  | 'other-wasm'
  | 'render-plan'
  | 'serialization'
  | 'shaping'
  | 'wasm-transition';

export function classifyCpuProfileStage(functionName: string, url: string): CpuProfileStage {
  const pathname = profileUrlPathname(url);
  if (url.startsWith(WASM_URL_PREFIX) || pathname.endsWith('.wasm')) {
    if (functionName.startsWith('js-to-wasm')) return 'wasm-transition';
    if (functionName.includes('codec_gather') || functionName.includes('append_planner_gather')) return 'gather';
    if (
      functionName.includes('ordered_plan') ||
      functionName.includes('render_plan_compiler') ||
      functionName.includes('plan_packing')
    ) {
      return 'render-plan';
    }
    if (functionName.includes('render_plan_wire') || functionName.includes('transport')) return 'serialization';
    if (functionName.includes('shaping_state') || functionName.includes('harfrust')) return 'shaping';
    if (functionName.includes('alloc') || functionName.includes('talc') || functionName.includes('RawVec')) {
      return 'allocation';
    }
    return 'other-wasm';
  }

  if (url.startsWith('node:') || url.length === 0) return 'host-runtime';
  if (
    pathname.includes(GLYPH_PACKAGE_PATH) ||
    pathname.includes(GLYPH_WORKSPACE_SOURCE_PATH) ||
    pathname.includes(GLYPH_WORKSPACE_DIST_PATH)
  ) {
    return 'javascript';
  }
  if (pathname.includes('/benches/')) return 'benchmark-harness';
  return 'external-javascript';
}

function profileUrlPathname(url: string): string {
  try {
    return new URL(url, 'file:///').pathname;
  } catch {
    return '';
  }
}
