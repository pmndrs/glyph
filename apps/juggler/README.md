# Juggler

A stick figure juggles the letters you type. Each keypress adds a glyph to a row at the top of the view; the row drops
one letter at a time, and the juggler runs under each one, catches it, and tosses it to the other hand in a cascade
that grows taller as more letters join. Backspace removes the newest letter.

The juggler has superhuman speed and always catches every letter. That is a property of the simulation in
`src/juggler.ts`, not luck: the body chases the letter that will land soonest, a hand that is still holding a letter
tosses it the instant another one arrives, and a catch places the hand exactly under the letter however far the arm
stretches. `src/juggler.test.ts` types a word and a forty-letter burst, steps the world for tens of seconds, and asserts
that no letter ever passes the hands.

The scene in `src/app.tsx` renders each letter with `@pmndrs/glyph/react`'s `Text` inside one `TextGroup`, and poses a
stick figure of plain meshes with two-bone inverse kinematics. Simulation steps run in the R3F physics phase; view
synchronization runs afterward in the update phase.

```sh
mise exec -- pnpm --filter @pmndrs/glyph-juggler dev
mise exec -- pnpm --filter @pmndrs/glyph-juggler test
mise exec -- pnpm --filter @pmndrs/glyph-juggler check
```

The checked-in `assets/inter-latin.font.glb` is a Basic Latin MSDF bake of Inter Regular produced through
`pnpm glyph bake`; `bake:check` verifies byte-identical regeneration.
