import * as THREE from 'three/webgpu';

import { emToWorld, type EmPolyline, type GlyphCollider } from './glyph-colliders';
import { COLLIDER_DEPTH_EM } from './glyph-physics-world';

/** Draws above every glyph draw, whatever the glyph renderer's own ordering. */
const OVERLAY_RENDER_ORDER = 1_000_000;
/**
 * A deep cyan, not a bright one: the glyph fill is white, and the edges of a thin straight stroke lie on the fill's own
 * edge, so a pale cyan (0x2bf0ff) has almost no contrast against it and the stroke reads as having no collider at all.
 */
const COLLIDER_COLOR = 0x0096c7;
const OUTLINE_COLOR = 0xff3da6;

export interface OverlayVisibility {
  readonly colliders: boolean;
  readonly outlines: boolean;
}

interface OverlayGeometries {
  readonly collider: THREE.BufferGeometry;
  readonly outline: THREE.BufferGeometry;
}

/** Pushes one line segment between two points. */
function segment(positions: number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  positions.push(ax, ay, az, bx, by, bz);
}

/** The edges of every convex piece's prism: the front loop, the back loop, and the edges joining them. */
function colliderEdges(pieces: readonly EmPolyline[], fontSize: number): Float32Array {
  const halfDepth = (COLLIDER_DEPTH_EM * fontSize) / 2;
  const positions: number[] = [];
  const current = { x: 0, y: 0 };
  const next = { x: 0, y: 0 };
  for (const piece of pieces) {
    const count = piece.length / 2;
    for (let index = 0; index < count; index += 1) {
      const following = (index + 1) % count;
      emToWorld(piece[2 * index]!, piece[2 * index + 1]!, fontSize, current);
      emToWorld(piece[2 * following]!, piece[2 * following + 1]!, fontSize, next);
      segment(positions, current.x, current.y, halfDepth, next.x, next.y, halfDepth);
      segment(positions, current.x, current.y, -halfDepth, next.x, next.y, -halfDepth);
      segment(positions, current.x, current.y, -halfDepth, current.x, current.y, halfDepth);
    }
  }
  return Float32Array.from(positions);
}

/** The flattened source contours as closed loops, drawn on the prism's front face. */
function outlineEdges(contours: readonly EmPolyline[], fontSize: number): Float32Array {
  const frontZ = (COLLIDER_DEPTH_EM * fontSize) / 2;
  const positions: number[] = [];
  const current = { x: 0, y: 0 };
  const next = { x: 0, y: 0 };
  for (const contour of contours) {
    const count = contour.length / 2;
    for (let index = 0; index < count; index += 1) {
      const following = (index + 1) % count;
      emToWorld(contour[2 * index]!, contour[2 * index + 1]!, fontSize, current);
      emToWorld(contour[2 * following]!, contour[2 * following + 1]!, fontSize, next);
      segment(positions, current.x, current.y, frontZ, next.x, next.y, frontZ);
    }
  }
  return Float32Array.from(positions);
}

function lineGeometry(positions: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function overlayMaterial(color: number): THREE.LineBasicNodeMaterial {
  return new THREE.LineBasicNodeMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    opacity: 1,
    transparent: true,
  });
}

/**
 * Wireframes for review: every convex collider piece as a prism, and the flattened source outline it was built from.
 * Both are drawn from the exact data the physics world was given, one line object per body that shares its glyph's
 * geometry, so a body's pose is a transform and no vertex is rewritten per frame.
 */
export class ColliderOverlay {
  readonly root = new THREE.Group();
  readonly #colliders = new THREE.Group();
  readonly #outlines = new THREE.Group();
  readonly #colliderLines: THREE.LineSegments[] = [];
  readonly #outlineLines: THREE.LineSegments[] = [];
  readonly #geometries = new Map<GlyphCollider, OverlayGeometries>();
  readonly #colliderMaterial = overlayMaterial(COLLIDER_COLOR);
  readonly #outlineMaterial = overlayMaterial(OUTLINE_COLOR);
  readonly #fontSize: number;

  constructor(fontSize: number) {
    this.#fontSize = fontSize;
    this.root.add(this.#colliders, this.#outlines);
    this.setVisibility({ colliders: false, outlines: false });
  }

  /** Adds the overlay for one body, in the order bodies are added to the physics world. */
  addBody(collider: GlyphCollider): void {
    let geometries = this.#geometries.get(collider);
    if (geometries === undefined) {
      geometries = {
        collider: lineGeometry(colliderEdges(collider.pieces, this.#fontSize)),
        outline: lineGeometry(outlineEdges(collider.contours, this.#fontSize)),
      };
      this.#geometries.set(collider, geometries);
    }
    const colliderLines = new THREE.LineSegments(geometries.collider, this.#colliderMaterial);
    const outlineLines = new THREE.LineSegments(geometries.outline, this.#outlineMaterial);
    colliderLines.renderOrder = OVERLAY_RENDER_ORDER;
    outlineLines.renderOrder = OVERLAY_RENDER_ORDER + 1;
    this.#colliderLines.push(colliderLines);
    this.#outlineLines.push(outlineLines);
    this.#colliders.add(colliderLines);
    this.#outlines.add(outlineLines);
  }

  setPose(index: number, x: number, y: number, angle: number): void {
    for (const lines of [this.#colliderLines[index]!, this.#outlineLines[index]!]) {
      lines.position.set(x, y, 0);
      lines.rotation.z = angle;
    }
  }

  setVisibility({ colliders, outlines }: OverlayVisibility): void {
    this.#colliders.visible = colliders;
    this.#outlines.visible = outlines;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
    for (const { collider, outline } of this.#geometries.values()) {
      collider.dispose();
      outline.dispose();
    }
    this.#geometries.clear();
    this.#colliderMaterial.dispose();
    this.#outlineMaterial.dispose();
  }
}
