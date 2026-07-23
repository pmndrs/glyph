---
name: open-knowledge-format
description: Create, convert, inspect, query, validate, or maintain Open Knowledge Format (OKF) knowledge bundles made from linked Markdown concept files with YAML frontmatter. Use when the user mentions OKF, Open Knowledge Format, knowledge bundles, LLM wikis, portable agent knowledge, OKF conformance, or asks to make repository knowledge interoperable across human and agent tools. Do not use for ordinary Markdown documentation unless OKF compatibility or a knowledge bundle is requested.
---

# Open Knowledge Format

Apply the upstream OKF specification faithfully while keeping the bundle useful to humans and agents. OKF is a transport and interoperability format, not a prescribed domain taxonomy or replacement for OpenAPI, schemas, ADR formats, or documentation methods such as Diátaxis.

Read [references/okf-v0.1.md](references/okf-v0.1.md) before designing or validating a bundle. OKF v0.1 is a draft; when exact conformance matters and internet access is available, verify the current [upstream specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

## Preserve the interoperability contract

Treat only these as hard v0.1 conformance requirements:

1. Every non-reserved Markdown concept file has parseable YAML frontmatter.
2. Every concept frontmatter block has a non-empty `type` field.
3. Reserved `index.md` and `log.md` files follow their specified structures when present.

Treat titles, descriptions, timestamps, indexes, logs, citations, and working links as quality recommendations unless the upstream specification says otherwise. Never reject a bundle merely because it contains unknown types or fields, missing optional metadata, a missing index, or a broken link.

## Choose the operation

### Create or convert a bundle

1. Identify the knowledge domain, authoritative sources, intended consumers, and bundle root.
2. Inventory atomic concepts before writing files. Use one concept per non-reserved Markdown file.
3. Fix the proposed paths before adding cross-links; the path without `.md` is the concept ID.
4. Preserve source material and record uncertainty. Do not invent facts, resources, timestamps, relationships, or citations.
5. Add the required `type` and warranted optional metadata.
6. Express relationships with normal Markdown links and explanatory surrounding prose.
7. Add concise indexes for progressive disclosure and a log only when they add value.
8. Validate hard conformance separately from producer-quality warnings.

### Maintain a bundle

1. Inspect the changed sources and the affected concepts.
2. Update facts and relationships without deleting unknown producer-defined fields.
3. When moving a concept, update inbound links across the bundle.
4. Update relevant indexes and add a newest-first log entry if the bundle uses logs.
5. Avoid rewriting historical log entries solely to repair links to moved concepts.
6. Revalidate and report both errors and warnings.

### Query a bundle

1. Start at the root `index.md` when present; otherwise inventory paths and frontmatter.
2. Use `type`, `title`, `description`, tags, and links to select relevant concepts.
3. Read only the bodies needed to answer the question.
4. Cite the concept paths used and distinguish bundle facts from inference.

### Validate a bundle

Report two levels:

- **Errors:** violations of the three hard conformance requirements.
- **Warnings:** missing recommended metadata, unresolved links, orphan concepts, weak navigation, missing citations, malformed dates, or stale claims.

Do not label producer-quality warnings as spec violations. Fix warnings when the user requests a production-quality bundle, while preserving the consumer's permissive behavior.

## Author concept files

Use the minimal valid shape:

```markdown
---
type: Component
title: Font Shaper
description: Converts styled Unicode runs into positioned glyphs.
---

The font shaper consumes the [font data contract](/contracts/font-data.md).
```

Use optional fields only when known:

- `title`: human-readable display name;
- `description`: one-sentence summary;
- `resource`: canonical URI for the described asset;
- `tags`: short cross-cutting labels;
- `timestamp`: ISO 8601 time of the last meaningful change.

Preserve all unknown fields during edits. Use descriptive free-form types and tolerate types the consumer does not recognize.

## Handle reserved files

- Use `index.md` for concise navigation and progressive disclosure.
- Use `log.md` for newest-first dated history with `YYYY-MM-DD` headings.
- Do not treat either reserved filename as a concept.
- Permit a bundle-root `index.md` to declare `okf_version: "0.1"` in frontmatter.
- Do not add frontmatter to nested indexes.
- Keep long explanations in concept files and link to them from indexes.

## Link and cite responsibly

- Use standard Markdown links with `.md` for concept targets.
- Prefer bundle-root-relative links for cross-directory relationships and relative links for nearby concepts.
- Explain the relationship in prose; OKF links are directed but untyped.
- Put source-backed claims under a final `# Citations` section when appropriate.
- Prefer links over duplicated knowledge, but do not fragment one coherent concept into trivia-sized files.
- Never include credentials, secrets, or access tokens.

## Compose with Diátaxis

Use OKF to make a knowledge collection portable and connected. Use Diátaxis to decide how a reader-facing documentation page should serve a user. A concept may link to tutorials, how-to guides, reference, explanations, ADRs, schemas, or source code without absorbing those formats.

## Final check

- Confirm the bundle root and every concept ID.
- Confirm one coherent concept per concept file.
- Validate frontmatter and non-empty types.
- Validate reserved-file structure.
- Preserve unknown metadata.
- Check links, citations, indexes, and logs as producer-quality concerns.
- Report assumptions and gaps instead of filling them with invented content.
