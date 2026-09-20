# Juggler

A stick figure juggles the letters you type. The sentence appears at the top as one shaped paragraph with the engine's
kerning and word spacing; each letter is struck in white-hot with flames and embers, and cools through yellow, orange,
and red to steel. The sentence then drops its letters one at a time in typing order: a letter hops out with a spin and
a squash, the paragraph flinches, and the letter takes a colour as it falls. The juggler runs under it, catches it, and
tosses it to the other hand in a cascade that grows taller as more letters join. Backspace removes the newest
character. With nothing to juggle, the figure waves for input.

The juggler has stats: body speed, hand speed, reach, and grip. He runs to stand under the letter that lands soonest,
leaning toward the other hand's next catch as far as his reach allows, and a hand closes only on a letter within its
grip. Type more than he can handle and letters drop; a dropped letter falls to the floor and explodes into shards.

The app is built the way the hero is: one koota world shared by the `letters` and `juggler` domains, trait files that
hold only data, actions for state transitions, systems that advance state, renderers that mount view traits, and every
system listed in execution order in `src/frameloop.ts`. Vector and matrix work uses the `math` package. The
simulation runs without React; `src/juggler/systems.test.ts` types words and a forty-letter burst through the real
systems and asserts the catching, dropping, exploding, releasing, reaching, waving, and deleting stories.

The sentence's paragraph is never drawn: it is a layout oracle parked off screen, and each committed layout seats every
letter on its glyph's ink centre. Every letter is its own one-glyph `Text` sharing a single forge material, with its
heat, tint progress, and hue encoded in the instance style colour and outline, so typing never compiles a shader.
Flames and shards are one instanced mesh each.

```sh
mise exec -- pnpm --filter @pmndrs/glyph-juggler dev
mise exec -- pnpm --filter @pmndrs/glyph-juggler test
mise exec -- pnpm --filter @pmndrs/glyph-juggler check
```

The checked-in `assets/inter-latin.font.glb` is a Basic Latin MSDF bake of Inter Regular produced through
`pnpm glyph bake`; `bake:check` verifies byte-identical regeneration.
