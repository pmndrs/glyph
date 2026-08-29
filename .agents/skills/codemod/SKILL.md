---
name: codemod
description: Author, archive, apply, and verify TypeScript codemods with ts-morph. Use for public API migrations, symbol renames, call-signature rewrites, import moves, or requests to preserve a dated migration recipe for users and agents. Do not use global text replacement for TypeScript or TSX.
---

# Codemod

Use pinned `ts-morph` for TypeScript and TSX migrations. A codemod is a complete migration recipe, not merely a rename
map: it combines deterministic AST transforms with enough semantic guidance for an agent to rewrite call sites that
cannot be changed mechanically.

## Choose a mode

- **Apply an archived codemod:** list the archive, select every recipe after the caller's current canary, and read each
  recipe's `recipe.json` and `instructions.md` completely before changing files.
- **Author a codemod:** read [references/recipe-format.md](references/recipe-format.md), create one dated recipe, test its
  automatic transform, and prove its agent-directed steps against real call sites.
- **Rename repository symbols:** author the dated recipe first, then apply it to this repository. The recipe is the
  durable record and consumer migration aid; an ignored one-off script is not sufficient.

List archived recipes without loading their instructions:

```bash
mise exec -- node .agents/skills/codemod/scripts/list-codemods.mjs
```

Verify that every archived migration is already applied, or apply the complete archive in lexical order:

```bash
mise exec -- node .agents/skills/codemod/scripts/run-all-codemods.mjs \
  --project path/to/tsconfig.json --target path/to/project --check
mise exec -- node .agents/skills/codemod/scripts/run-all-codemods.mjs \
  --project path/to/tsconfig.json --target path/to/project --write
```

## Apply safely

1. Resolve the exact target root and tsconfig. Never target a broad home, workspace parent, dependency store, or
   `node_modules` directory.
2. Run the deterministic transform without `--write` first. Review every reported file and inspect the diff that would
   result.
3. Apply with `--write` only when the user authorized mutation:

   ```bash
   mise exec -- node .agents/skills/codemod/scripts/run-codemod.mjs \
     --codemod .agents/skills/codemod/codemods/YYYY-MM-DD-name \
     --project path/to/tsconfig.json \
     --target path/to/project \
     --write
   ```

4. Follow `instructions.md` for semantic sites the transform deliberately leaves unresolved. Preserve the stated
   ownership, ordering, error, and lifecycle invariants; stop for a real user decision instead of guessing.
5. Use AST queries to enumerate remaining old imports, identifiers, property accesses, call shapes, comments, and string
   literals. Change human-facing strings deliberately; do not rename protocol values, persisted data, fixture identities,
   generated ABI names, or artifact paths because their spelling resembles an API symbol.
6. Run every recipe verification command plus the affected package checks. Generated JavaScript, declarations, digests,
   and ABI files are regenerated through their owning workflow, never edited by the codemod.

For symbol renames, use the runner's `renameSymbol()` helper. It delegates identifiers to ts-morph's language service,
scans actual comment trivia separately, and never renames string literals. A successful typecheck is necessary but does
not prove semantic call sites were migrated; the recipe's behavioral postconditions remain required.

## Archive rules

Recipes live under `codemods/YYYY-MM-DD-slug/` and are applied in lexical date order. Once a recipe has been shared with
canary users, do not rewrite its migration meaning. Add a later corrective recipe so users can apply an ordered chain.
The archive is the canonical rename and call-site map; public prose links to it or is rendered from it.
