import {
  color,
  dFdx,
  dFdy,
  float,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  RepeatWrapping,
  Scene,
  Vector2,
  type WebGPURenderer,
} from 'three/webgpu';
import { retained } from '../hmr';

/** Paper grain follows the icon paper in the paper's own plane units. */
export const uPaperDrift = uniform(new Vector2());

/**
 * The grain is three octaves of noise, and a plane the size of the screen at a retina pixel ratio asks for them
 * millions of times a frame. Baked once into a tile that wraps, in world units, the paper reads its height and
 * its slope back with one sample. The finest octave has fourteen or so cycles a unit, so the tile holds four
 * texels for each.
 */
const TILE = 32;
const TILE_TEXELS = 2048;

/** The tile, kept across a module replacement so the paper keeps reading the one it was baked into. */
const grainTile = retained('paper-grain', () => {
  const target = new RenderTarget(TILE_TEXELS, TILE_TEXELS);
  target.texture.name = 'paper-grain';
  target.texture.wrapS = RepeatWrapping;
  target.texture.wrapT = RepeatWrapping;

  return { target, baked: false };
});

function grainAt(point: Node<'vec3'>): Node<'float'> {
  return mx_noise_float(point.mul(2.4))
    .mul(0.6)
    .add(mx_noise_float(point.mul(2.4 * 2.7)).mul(0.3))
    .add(mx_noise_float(point.mul(2.4 * 6.1)).mul(0.1));
}

/**
 * Bake the tile: the grain blended from four copies of itself, each shifted a tile along an axis and weighted so
 * the copies agree along every edge, which is what lets the tile wrap. Height goes in red and the surface's
 * slope, from the height's derivatives across the tile's texels scaled to a screen pixel's, in green and blue,
 * each carried as a fraction around one half.
 */
export function bakePaperGrain(renderer: WebGPURenderer): void {
  if (grainTile.baked) return;

  const material = new MeshBasicNodeMaterial({ name: 'paper-grain-bake', toneMapped: false });
  const at = uv().mul(TILE);
  const corners: [number, number][] = [
    [0, 0],
    [-TILE, 0],
    [0, -TILE],
    [-TILE, -TILE],
  ];
  const weights = [
    uv().x.oneMinus().mul(uv().y.oneMinus()),
    uv().x.mul(uv().y.oneMinus()),
    uv().x.oneMinus().mul(uv().y),
    uv().x.mul(uv().y),
  ];
  const grain = corners
    .map(([x, y], index) => grainAt(vec3(at.add(vec2(x, y)), 0)).mul(weights[index]!))
    .reduce((sum, term) => sum.add(term));
  // The grain used to be tilted by its slope across a screen pixel, at about seventy pixels a unit; the tile's
  // texels are sixty-four a unit, so the slope across a texel is scaled to match.
  const slope = 0.9 * (TILE_TEXELS / TILE / 70);
  const normal = normalize(vec3(dFdx(grain).mul(-slope), dFdy(grain).mul(-slope), 1));
  material.fragmentNode = vec4(grain.mul(0.5).add(0.5), normal.xy.mul(0.5).add(0.5), 1);
  const scene = new Scene();
  const geometry = new PlaneGeometry(2, 2);
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const previous = renderer.getRenderTarget();

  try {
    renderer.setRenderTarget(grainTile.target);
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(previous);
    geometry.dispose();
    material.dispose();
  }

  grainTile.baked = true;
}

/** Baked paper grain, scrolled with the icon paper: its height tints and roughens, and its slope tilts the normal. */
export const paperMaterial = new MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0 });
const sample = positionLocal.xy.add(uPaperDrift).div(TILE);
const tile = texture(grainTile.target.texture, sample);
const grain = tile.r.mul(2).sub(1);
paperMaterial.normalNode = normalize(vec3(tile.g.mul(2).sub(1), tile.b.mul(2).sub(1), 1));
paperMaterial.colorNode = mix(color('#efebe1'), color('#f8f6f1'), grain.mul(0.5).add(0.5));
paperMaterial.roughnessNode = mix(float(0.88), float(1), grain.mul(0.5).add(0.5));
