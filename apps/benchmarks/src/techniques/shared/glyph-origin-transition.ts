import type { FontFeature } from '@pmndrs/glyph';
import type { GlyphPlacements } from '@pmndrs/glyph/three';

/**
 * The part of a committed target-v1 `Text` this helper needs.
 *
 * Core owns the snapshot, its identity, and the topology-guarded write; interpolation and the policy
 * that decides whether a reflow may interpolate at all stay here, in the application, because they
 * are presentation choices rather than layout facts.
 */
export interface TransitionableText {
  snapshotGlyphs(): GlyphPlacements | undefined;
  applyGlyphs(placements: GlyphPlacements): { readonly applied: number; readonly requested: number };
  restoreGlyphs(): void;
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
 * This mirrors the durability `GlyphKey` documents. A key survives a reflow that moves glyphs and not one that reshapes
 * them, so a change to the source text — or to the fixture, script, or features that decide which glyphs the text shapes
 * into — snaps. Under bidi, inserting one character reorders a whole run, so a typewriter reveal that kept matching
 * would slide glyphs across their neighbours to reach positions they never travelled through. Geometry and style changes
 * leave the shaped run and its visual order intact, so their glyphs really do move continuously.
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
  text.restoreGlyphs();
  return { transitioned: false, matchedGlyphs: 0, targetGlyphs: text.snapshotGlyphs()?.glyphs.length ?? 0 };
}

/** Displayed glyph origins copied out of one committed paragraph. It retains no renderer or core resources. */
export type GlyphOriginSnapshot = GlyphPlacements;

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

/**
 * Copies the displayed origins of the currently committed paragraph. An uncommitted `Text` has nothing to move from,
 * which is a normal first-frame state rather than a failure, so it yields `undefined` and matches nothing.
 */
export function captureGlyphOrigins(text: TransitionableText): GlyphOriginSnapshot | undefined {
  return text.snapshotGlyphs();
}

/**
 * Moves the committed paragraph's displayed origins from where the matching glyphs used to be toward where the new
 * layout puts them. The target is the shaped origin rather than the current displayed one, so restarting a transition
 * mid-flight still converges on the authoritative layout instead of on a partially interpolated position.
 */
export function createGlyphOriginTransition(
  text: TransitionableText,
  from: GlyphOriginSnapshot | undefined,
): GlyphOriginTransition {
  const placements = text.snapshotGlyphs();
  if (placements === undefined) throw new TypeError('glyph-origin transition requires a committed paragraph');
  const adoption = from === undefined ? undefined : placements.adopt(from);
  const glyphs = placements.glyphs;
  const targetGlyphs = glyphs.length;
  // `adopt` left each matched glyph at its previous drawn position and each unmatched glyph at its shaped one, so the
  // snapshot itself is the start of the interpolation and only the two start columns need retaining.
  const startX = Float64Array.from(glyphs, (glyph) => glyph.x);
  const startY = Float64Array.from(glyphs, (glyph) => glyph.y);
  let progress = 1;
  let disposed = false;
  const setProgress = (nextProgress: number): void => {
    if (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 1) {
      throw new RangeError('glyph-origin transition progress must be in [0, 1]');
    }
    // A reflow publishes a new layout together with a new topology, which is exactly when interpolating between the old
    // and new glyph sets would be meaningless. `applyGlyphs` refuses a superseded snapshot, so staleness is reported
    // rather than written; disposal reads the same way.
    if (disposed) throw new DOMException('The glyph-origin transition is stale', 'AbortError');
    for (let index = 0; index < targetGlyphs; index += 1) {
      const glyph = glyphs[index]!;
      glyph.x = startX[index]! + (glyph.shapedX - startX[index]!) * nextProgress;
      glyph.y = startY[index]! + (glyph.shapedY - startY[index]!) * nextProgress;
    }
    text.applyGlyphs(placements);
    progress = nextProgress;
  };
  return {
    matchedGlyphs: adoption?.matched ?? 0,
    targetGlyphs,
    get progress() {
      return progress;
    },
    setProgress,
    finish() {
      if (disposed) return;
      setProgress(1);
      // Settled motion hands authority back to the layout. This is a step of the snapshot/manipulate/restore cycle
      // rather than a call discovered by watching an override outlive the motion that set it.
      text.restoreGlyphs();
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
  from: GlyphOriginSnapshot | undefined,
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
