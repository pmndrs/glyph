# Noto Sans Symbols 2

Vendored from [Google Fonts](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notosanssymbols2),
revision `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`, under the SIL Open Font License in `OFL.txt`.
The license is also included in the application's built `notices.txt`.

- Font SHA-256: `7d5fb73b7ca67a6798101741f5d280a3d016a56a197afcd4199dbb57b4b82a21`
- License SHA-256: `b118dd41337806a5d4797052c77caf3bd096aed783e5eb21b4d11154351e1ac0`

`mise exec -- pnpm scripts run hero:star-font` restores these source files from the pinned revision;
add `-- --check` to compare without writing.
`mise exec -- pnpm scripts run hero:bake -- --only=stars` bakes only the six Unicode stars declared in
`src/black-hole/utils.ts` into `assets/stars.font.glb`; add `--check` to verify the bake.
