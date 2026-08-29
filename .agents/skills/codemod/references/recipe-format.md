# Codemod recipe format

Each directory under `codemods/` is a self-contained, ordered migration:

```text
YYYY-MM-DD-slug/
├── recipe.json
├── instructions.md
├── transform.mjs
└── test.mjs            # required when the automatic transform is non-empty
```

Add fixtures only when they make a structural transform materially easier to verify. Do not add a duplicate README or
central handwritten index; `list-codemods.mjs` discovers recipes from their manifests.

## `recipe.json`

Use this shape:

```json
{
  "schemaVersion": 1,
  "id": "2026-08-28-runtime-ownership",
  "created": "2026-08-28",
  "package": "@pmndrs/glyph",
  "from": "canary before <commit-or-version>",
  "to": "canary at or after <commit-or-version>",
  "summary": "Rename runtime ownership and migrate host/session construction.",
  "instructions": "./instructions.md",
  "transform": "./transform.mjs",
  "changes": [
    {
      "kind": "symbol-rename",
      "from": "TextRuntime",
      "to": "TextEngine",
      "automatic": true
    },
    {
      "kind": "call-rewrite",
      "from": "createTextEngineHost(runtime, options)",
      "to": "runtime.createHost(options)",
      "automatic": false
    }
  ],
  "verification": ["mise exec -- pnpm --filter <consumer> typecheck"]
}
```

The `changes` array is the canonical machine-readable migration map. Use `kind` values that describe the operation:
`symbol-rename`, `import-move`, `call-rewrite`, `property-rewrite`, `remove`, or `manual`. Set `automatic` honestly.

## `instructions.md`

Write for a capable agent migrating a real consumer. Include only facts that affect the rewrite:

- the old and new ownership/lifecycle model;
- representative before/after call sites for each structural change;
- invariants that must survive the rewrite;
- how to classify ambiguous sites and when to stop for user direction;
- patterns intentionally left unchanged, especially wire strings and persisted values;
- residual-use queries and behavioral success checks.

Do not repeat the machine-readable table as prose. Explain how the changes compose and why a call-site shape changes.

## `transform.mjs`

Export `metadata` and `transform`:

```js
export const metadata = Object.freeze({ id: '2026-08-28-runtime-ownership' });

export function transform({ project, renameSymbol }) {
  const declaration = project.getSourceFileOrThrow('src/runtime.ts').getInterfaceOrThrow('TextRuntime');
  renameSymbol(declaration, 'TextEngine');
}
```

The runner owns saving. The transform mutates only the in-memory ts-morph project and must not call `save`, write files,
spawn formatters, or edit generated output. Use symbol-aware `rename()` for identifiers and explicit AST replacements for
call structure. `renameSymbol()` delegates code references to ts-morph and replaces exact identifier tokens only inside
comment trivia found by the TypeScript scanner; it never changes strings. Never use source-file-wide string replacement.

## Proof

At minimum, the test must prove that dry-run leaves disk unchanged, `--write` changes declarations and references,
comments follow symbol renames when intended, and string literals remain unchanged. Structural transforms need focused
before/after fixtures plus a typecheck or executable behavioral assertion.
