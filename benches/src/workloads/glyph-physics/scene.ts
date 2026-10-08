import * as THREE from 'three/webgpu';
import type { Box3DModule } from 'box3d.js';

import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from '../comparison/contracts';
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  exactWidth,
  paintColor,
  publishWorkloadTexts,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';
import { GlyphPhysicsScene, wallSpan } from './glyph-physics-scene';
import { loadBox3d } from './glyph-physics-world';

/** The paragraph that falls. The glyph-count control takes a prefix of it, so a smaller scene is a shorter text. */
export const GLYPH_PHYSICS_TEXT =
  'Bodega AQ8. Typography is the craft of giving language a body. Every letter here is a rigid body whose collider is its own ' +
  'outline: the counter of an o stays open, the bowls of a B and an 8 stay hollow, and an A stands on its two feet. ' +
  'Counters catch their neighbours, curves roll, serifs and spurs hook one another, and the whole paragraph settles ' +
  'into a pile whose shape is the shape of the type. Watch how a small g tips onto its tail, how an i balances on its ' +
  'dot until a neighbour nudges it, and how a lowercase e lies on its side with its eye facing the sky. Then the ' +
  'floor resets, the letters return to their lines, and the same paragraph falls the same way again.';

const MINIMUM_CHARACTERS = 24;
/** The paragraph never gets narrower than this, so a very small viewport still wraps into readable lines. */
const MINIMUM_CONTENT_WIDTH = 160;
/** Gap between each wall and the paragraph's measure, in pixels, so the first line starts clear of the walls. */
const WALL_PADDING = 24;
/**
 * How far above the viewport's top edge the paragraph starts, as a fraction of the viewport height. The lines fall from
 * above the screen onto the floor, so they land on top of one another and the glyphs pile instead of lying in one row.
 */
const DROP_HEIGHT_RATIO = 0.15;

/** Maps the shared 0..100 amount control onto a character count of the paragraph, repeating it if it must grow. */
export function glyphPhysicsText(amount: number): string {
  const normalized = Math.min(100, Math.max(0, amount)) / 100;
  const characters = MINIMUM_CHARACTERS + Math.round(normalized * (GLYPH_PHYSICS_TEXT.length - MINIMUM_CHARACTERS));
  return GLYPH_PHYSICS_TEXT.slice(0, characters).trimEnd();
}

/** The paragraph's measure: a fraction of the space between the walls, less their padding, so it starts between them. */
export function glyphPhysicsContentWidth(viewportWidth: number, layoutWidthRatio: number): number {
  const { left, right } = wallSpan(viewportWidth);
  return Math.max(MINIMUM_CONTENT_WIDTH, (right - left - WALL_PADDING * 2) * layoutWidthRatio);
}

let readyBox3d: Box3DModule | undefined;
const scenes = new WeakMap<ComparisonWorkloadEntry, GlyphPhysicsScene>();

function sceneOf(entry: ComparisonWorkloadEntry): GlyphPhysicsScene {
  const scene = scenes.get(entry);
  if (scene === undefined) throw new Error('glyph physics entry lost its simulation');
  return scene;
}

/** Simulated time per wall-clock time: the animation-speed control's default of 50 is real time. */
export function glyphPhysicsTimeScale(animationSpeed: number): number {
  return animationSpeed / 50;
}

export function createGlyphPhysicsEntries(
  context: WorkloadTextFactoryContext &
    Pick<ComparisonWorkloadConfiguration, 'amount' | 'fontSize' | 'layoutWidthRatio'> & {
      readonly outlinedFont: WorkloadTextFactoryContext['font'];
      readonly viewportWidth: number;
    },
): readonly ComparisonWorkloadEntry[] {
  if (readyBox3d === undefined) throw new Error('glyph physics needs its Box3D module prepared before it is created');
  const source = glyphPhysicsText(context.amount);
  const text = context.root.createText({
    font: context.outlinedFont,
    rasterPixelRatio: context.dpr,
    text: source,
    style: { fontSize: context.fontSize, lineHeight: LIVE_TEXT_LINE_HEIGHT, color: paintColor(LIVE_TEXT_COLOR) },
    constraints: {
      width: exactWidth(glyphPhysicsContentWidth(context.viewportWidth, context.layoutWidthRatio)),
    },
    layout: { wrap: 'word' },
  });
  const node = new THREE.Group();
  node.add(text);
  const simulation = new GlyphPhysicsScene(readyBox3d, node, text, context.fontSize);
  const entry: ComparisonWorkloadEntry = {
    detachedRoot: node,
    dispose: () => simulation.dispose(),
    node,
    physics: simulation,
    role: 'primary',
    sourceText: source,
    text,
  };
  scenes.set(entry, simulation);
  return [entry];
}

export const glyphPhysicsWorkload = {
  animate(entries, configuration, elapsedMs, viewportWidth, viewportHeight, scene, _scratch, onError) {
    try {
      for (const entry of entries) {
        const simulation = sceneOf(entry);
        if (!simulation.active) {
          // A Text commits only once its root is under a Scene, which the host does after `layout`; this first frame
          // is the earliest point `breakApart` can run, and publishing here commits it without waiting for the render.
          publishWorkloadTexts(scene, entries);
          simulation.activate(
            { height: viewportHeight, width: viewportWidth },
            { colliders: configuration.showColliders, outlines: configuration.showOutlines },
          );
        }
        simulation.advance(
          elapsedMs,
          configuration.animationEnabled,
          glyphPhysicsTimeScale(configuration.animationSpeed),
        );
      }
    } catch (error) {
      onError(error);
    }
  },
  applyRetainedConfiguration(entries, configuration) {
    for (const entry of entries) {
      sceneOf(entry).setVisibility({ colliders: configuration.showColliders, outlines: configuration.showOutlines });
    }
  },
  batching: 'group',
  cameraKind: 'orthographic',
  contentWidth: 'none',
  create(context) {
    const [outlinedFont] = context.companionFonts;
    if (outlinedFont === undefined) throw new Error('glyph physics needs its outlined font fixture');
    return createGlyphPhysicsEntries({ ...context.configuration, ...context, outlinedFont });
  },
  id: 'glyph-physics',
  layout(entries, context) {
    const { viewportHeight, viewportWidth } = context;
    for (const entry of entries) {
      const simulation = sceneOf(entry);
      if (simulation.active) {
        simulation.resize({ height: viewportHeight, width: viewportWidth });
        continue;
      }
      entry.text.position.set(wallSpan(viewportWidth).left + WALL_PADDING, viewportHeight * DROP_HEIGHT_RATIO, 0);
    }
  },
  async prepare() {
    readyBox3d = await loadBox3d();
  },
  suspendsIconWindow: false,
  updateKind(previous, next) {
    return previous.amount !== next.amount ||
      previous.fontSize !== next.fontSize ||
      previous.layoutWidthRatio !== next.layoutWidthRatio
      ? 'rebuild'
      : 'retained';
  },
} satisfies ComparisonWorkloadDefinition;
