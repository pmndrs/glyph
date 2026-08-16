import type { FontFeature, ParagraphLayoutInspection } from '@pmndrs/glyph';
import type { TextGlyphOriginSnapshot, TextGlyphOriginUpdate } from '@pmndrs/glyph/three';

/**
 * The part of a committed target-v1 `Text` this helper needs. Core owns glyph snapshots and topology-guarded
 * displayed-origin writes but deliberately keeps animation and matching policy out of the library, so identity matching
 * and interpolation live here — in the application — and every live technique scene shares this one implementation.
 */
export interface TransitionableText {
  inspectLayout(): ParagraphLayoutInspection | undefined;
  snapshotGlyphOrigins(): TextGlyphOriginSnapshot | undefined;
  setGlyphOrigins(update: TextGlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;
}

/**
 * The paragraph inputs that decide which glyphs exist and in what visual order. Font size, layout width, anchor, and
 * device pixel ratio are deliberately absent: they move the same glyphs rather than replacing or reordering them.
 */
export interface ShapedTextIdentity {
  readonly fontFixture: string;
  readonly text: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly features: readonly FontFeature[];
}

export type GlyphOriginPolicy = 'snap' | 'transition';

/**
 * The one place every live technique scene decides whether a reflow may interpolate glyph identities.
 *
 * Identity matching keys a glyph on its UTF-16 source cluster, which survives a reflow but says nothing about visual
 * order. Under bidi, inserting one character reorders a whole run, so a typewriter reveal that kept matching would
 * slide glyphs across their neighbours to reach positions they never travelled through. A change that alters the
 * source text — or the fixture, script, or features that decide which glyphs the text shapes into — therefore snaps.
 * Geometry and style changes leave the shaped run and its visual order intact, so their glyphs really do move
 * continuously and matching is sound.
 */
export function glyphOriginPolicy(previous: ShapedTextIdentity, next: ShapedTextIdentity): GlyphOriginPolicy {
  if (previous.text !== next.text) return 'snap';
  if (previous.fontFixture !== next.fontFixture) return 'snap';
  if (previous.language !== next.language || previous.direction !== next.direction) return 'snap';
  return sameFontFeatures(previous.features, next.features) ? 'transition' : 'snap';
}

/** What one committed reflow did with glyph identities, so a snapped update cannot report a match it never made. */
export interface GlyphOriginPresentation {
  readonly transitioned: boolean;
  /** Glyphs whose previous displayed origin was recovered by identity. Always `0` when the reflow snapped. */
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
}

/**
 * Presents a reflow with no interpolation, returning displayed origins to the layout that just committed. A change
 * that replaces or reorders glyphs has no correspondence to animate, so zero matches is the honest report.
 */
export function snapGlyphOrigins(text: TransitionableText): GlyphOriginPresentation {
  text.clearGlyphOriginOverrides();
  return { transitioned: false, matchedGlyphs: 0, targetGlyphs: text.inspectLayout()?.glyphIds.length ?? 0 };
}

/** Displayed glyph origins copied out of one committed paragraph. It retains no renderer or core resources. */
export interface GlyphOriginSnapshot {
  readonly glyphCount: number;
  /** Displayed origin per glyph, keyed by the shaping identity that survives a reflow. */
  readonly origins: ReadonlyMap<string, readonly [number, number]>;
}

/** Presentation-only motion toward one authoritative layout. Progress never changes what the layout committed. */
export interface GlyphOriginTransition {
  /** Glyphs whose previous displayed origin was recovered by identity; the rest start already placed. */
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
  readonly progress: number;
  setProgress(progress: number): void;
  finish(): void;
  dispose(): void;
}

const EMPTY_SNAPSHOT: GlyphOriginSnapshot = { glyphCount: 0, origins: new Map() };

/**
 * Copies the displayed origins of the currently committed paragraph. An uncommitted `Text` has nothing to move from,
 * which is a normal first-frame state rather than a failure, so it yields an empty snapshot that matches nothing.
 */
export function captureGlyphOrigins(text: TransitionableText): GlyphOriginSnapshot {
  const layout = text.inspectLayout();
  if (layout === undefined) return EMPTY_SNAPSHOT;
  const glyphs = text.snapshotGlyphOrigins();
  if (glyphs === undefined || glyphs.layout !== layout)
    throw new TypeError('glyph origin snapshot lost its inspection');
  const identities = glyphIdentityKeys(layout);
  const origins = new Map<string, readonly [number, number]>();
  for (let index = 0; index < identities.length; index += 1) {
    origins.set(identities[index]!, [glyphs.displayedX[index]!, glyphs.displayedY[index]!]);
  }
  return { glyphCount: identities.length, origins };
}

/**
 * Moves the committed paragraph's displayed origins from where the matching glyphs used to be toward where the new
 * layout puts them. The target is the shaped origin rather than the current displayed one, so restarting a transition
 * mid-flight still converges on the authoritative layout instead of on a partially interpolated position.
 */
export function createGlyphOriginTransition(
  text: TransitionableText,
  from: GlyphOriginSnapshot,
): GlyphOriginTransition {
  const layout = text.inspectLayout();
  if (layout === undefined) throw new TypeError('glyph-origin transition requires a committed paragraph');
  const glyphs = text.snapshotGlyphOrigins();
  if (glyphs === undefined || glyphs.layout !== layout)
    throw new TypeError('glyph origin snapshot lost its inspection');
  const identities = glyphIdentityKeys(layout);
  const targetGlyphs = identities.length;
  const fromX = glyphs.shapedX.slice();
  const fromY = glyphs.shapedY.slice();
  let matchedGlyphs = 0;
  for (let index = 0; index < targetGlyphs; index += 1) {
    const origin = from.origins.get(identities[index]!);
    if (origin === undefined) continue;
    fromX[index] = origin[0];
    fromY[index] = origin[1];
    matchedGlyphs += 1;
  }
  const targetX = glyphs.shapedX;
  const targetY = glyphs.shapedY;
  const displayedX = new Float32Array(targetGlyphs);
  const displayedY = new Float32Array(targetGlyphs);
  let progress = 1;
  let disposed = false;
  const setProgress = (nextProgress: number): void => {
    if (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 1) {
      throw new RangeError('glyph-origin transition progress must be in [0, 1]');
    }
    // A reflow publishes a new layout object and a new topology together, which is exactly when interpolating between
    // the old and new glyph arrays would be meaningless. Report it as staleness, the way a superseded update reads.
    if (disposed || text.inspectLayout() !== layout) {
      throw new DOMException('The glyph-origin transition is stale', 'AbortError');
    }
    for (let index = 0; index < targetGlyphs; index += 1) {
      const startX = fromX[index]!;
      const startY = fromY[index]!;
      displayedX[index] = startX + (targetX[index]! - startX) * nextProgress;
      displayedY[index] = startY + (targetY[index]! - startY) * nextProgress;
    }
    text.setGlyphOrigins({ layout, x: displayedX, y: displayedY });
    progress = nextProgress;
  };
  return {
    matchedGlyphs,
    targetGlyphs,
    get progress() {
      return progress;
    },
    setProgress,
    finish() {
      if (disposed) return;
      setProgress(1);
      // Settled motion must hand authority back to the layout: an override pinned at the target would otherwise
      // outlive this transition and silently shadow the next committed origins.
      text.clearGlyphOriginOverrides();
      disposed = true;
    },
    dispose() {
      disposed = true;
    },
  };
}

/** Duration the live technique scenes present a reflow over, matching the bitmap viewport's host-driven timeline. */
export const GLYPH_ORIGIN_TRANSITION_MS = 110;

/** A transition advanced by the host frame clock, for scenes whose surface does not drive progress itself. */
export interface FrameDrivenGlyphTransition {
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
  /** Applies the eased progress for `timestamp` and returns it; `1` means the transition has settled. */
  advance(timestamp: number): number;
  dispose(): void;
}

/**
 * Wraps one transition in the smoothstep timeline the bitmap viewport applies from React. The first advanced frame
 * starts the clock rather than the constructor, so a reflow that commits between two frames still presents in full.
 */
export function createFrameDrivenGlyphTransition(
  text: TransitionableText,
  from: GlyphOriginSnapshot,
  durationMs: number = GLYPH_ORIGIN_TRANSITION_MS,
): FrameDrivenGlyphTransition {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('glyph-origin transition duration must be positive');
  }
  const transition = createGlyphOriginTransition(text, from);
  transition.setProgress(0);
  let startedAt: number | undefined;
  return {
    matchedGlyphs: transition.matchedGlyphs,
    targetGlyphs: transition.targetGlyphs,
    advance(timestamp) {
      startedAt ??= timestamp;
      const linear = Math.min(1, Math.max(0, (timestamp - startedAt) / durationMs));
      if (linear === 1) {
        transition.finish();
        return 1;
      }
      const eased = linear * linear * (3 - 2 * linear);
      transition.setProgress(eased);
      return eased;
    },
    dispose() {
      transition.dispose();
    },
  };
}

/** Reports a reflow the scene chose to interpolate, keeping the snapped and transitioned reports one shape. */
export function transitionPresentation(transition: {
  readonly matchedGlyphs: number;
  readonly targetGlyphs: number;
}): GlyphOriginPresentation {
  return { transitioned: true, matchedGlyphs: transition.matchedGlyphs, targetGlyphs: transition.targetGlyphs };
}

function sameFontFeatures(previous: readonly FontFeature[], next: readonly FontFeature[]): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((feature, index) => {
    const other = next[index];
    return other !== undefined && feature.tag === other.tag && feature.value === other.value;
  });
}

/**
 * Reproduces the identity merged-v0 matched on: font handle, glyph id, cluster, exact font size, and the occurrence
 * index that separates otherwise identical glyphs within one paragraph.
 */
function glyphIdentityKeys(layout: ParagraphLayoutInspection): readonly string[] {
  assertParallelGlyphIdentity(layout);
  const counts = new Map<string, number>();
  const keys: string[] = [];
  for (let index = 0; index < layout.glyphIds.length; index += 1) {
    const fontHandle = layout.fontHandles[layout.glyphFontSlots[index]!];
    if (fontHandle === undefined) throw new TypeError('paragraph layout references a missing font slot');
    // Font size is deliberately absent. The merged renderer keyed on it, which made a glyph fail to match itself across
    // the one change the transition exists to animate, so a size change reported every glyph as new and interpolated
    // nothing. Font handle, glyph id, cluster, and occurrence still identify a glyph, and a uniform scale preserves
    // visual order, so matching across a resize recovers exactly the glyph that moved.
    const baseKey = `${fontHandle}:${layout.glyphIds[index]!}:${layout.clusters[index]!}`;
    const occurrence = counts.get(baseKey) ?? 0;
    counts.set(baseKey, occurrence + 1);
    keys.push(`${baseKey}:${occurrence}`);
  }
  return keys;
}

function assertParallelGlyphIdentity(layout: ParagraphLayoutInspection): void {
  const glyphCount = layout.glyphIds.length;
  for (const values of [
    layout.glyphStableIds,
    layout.clusters,
    layout.glyphFontSlots,
    layout.x,
    layout.y,
    layout.glyphFontSizes,
  ]) {
    if (values.length !== glyphCount) throw new TypeError('paragraph glyph identity arrays are not parallel');
  }
}
