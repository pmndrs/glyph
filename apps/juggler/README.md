# Juggler

A stick figure juggles the letters you type. The typed sentence appears at the top as one shaped paragraph, with the
engine's kerning and word spacing. Each letter arrives red hot and cools to white. The sentence then drops its letters
one at a time in typing order: a letter hops out of its slot with a spin and a squash, the paragraph flinches, and the
letter picks up a colour as it falls. The juggler runs under each one, catches it, and tosses it to the other hand in
a cascade that grows taller as more letters join. Backspace removes the newest character. With nothing to juggle, the
figure waves for input.

The juggler has superhuman speed and always catches every letter. That is a property of the simulation in
`src/juggler.ts`, not luck: the body chases the letter that will land soonest, a hand that is still holding a letter
tosses it the instant another one arrives, and a catch places the hand exactly under the letter however far the arm
stretches. Hands carry each catch inward along a scoop and throw from beside the body, and a free hand reaches toward
the next letter it will receive. `src/juggler.test.ts` types a sentence and a forty-letter burst, steps the world for
tens of seconds, and asserts that no falling letter ever passes the hands, that letters release in sentence order with
a hop, that a free hand reaches for its incoming letter, and that the idle wave starts.

The scene in `src/app.tsx` keeps the sentence as a single `Text` paragraph so shaping is uniform, parks it off screen,
and breaks each committed layout apart with `Text.breakApart()` into per-glyph copies drawn at the top of the view. A
glyph copy shows only while its letter waits and has cooled; a separate one-glyph `Text` per letter draws the hot
overlay on the paragraph and then becomes the falling letter. The stick figure is plain meshes posed with two-bone
inverse kinematics. Simulation steps run in the R3F physics phase; view synchronization runs afterward in the update
phase.

```sh
mise exec -- pnpm --filter @pmndrs/glyph-juggler dev
mise exec -- pnpm --filter @pmndrs/glyph-juggler test
mise exec -- pnpm --filter @pmndrs/glyph-juggler check
```

The checked-in `assets/inter-latin.font.glb` is a Basic Latin MSDF bake of Inter Regular produced through
`pnpm glyph bake`; `bake:check` verifies byte-identical regeneration.
