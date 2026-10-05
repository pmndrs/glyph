---
name: open-knowledge-format
description: Create, migrate, inspect, query, validate, or maintain Open Knowledge Format v0.2 bundles made from linked Markdown concepts with YAML provenance. Use when the user mentions OKF, Open Knowledge Format, knowledge bundles, LLM wikis, portable agent knowledge, OKF conformance, provenance, trust, lifecycle, attested computations, or asks to make repository knowledge interoperable across human and agent tools. Do not use for ordinary Markdown unless OKF compatibility or a knowledge bundle is requested.
---

# Open Knowledge Format

Apply the current upstream OKF v0.2 specification faithfully while keeping bundles useful to humans and agents. OKF is an interoperability format, not a domain taxonomy or replacement for OpenAPI, schemas, ADRs, or Diátaxis.

Read [references/okf-v0.2.md](references/okf-v0.2.md) completely before creating, migrating, or validating a bundle. When internet access is available and exact conformance matters, verify the current [upstream specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) before acting.

## Preserve the conformance boundary

Establish the bundle root first. Only Markdown inside that root belongs to the bundle.

Treat exactly these as hard v0.2 requirements:

1. Every non-reserved Markdown concept has parseable YAML frontmatter.
2. Every concept frontmatter block has a non-empty `type`.
3. Present `index.md` and `log.md` files follow their reserved structures.

Do not reject unknown types or fields, missing optional metadata, missing indexes, or broken links. Report those separately as producer-quality issues.

## Apply the producer profile

For every concept authored or meaningfully changed with this skill:

1. Require `generated.by` and `generated.at`; use the truthful v0.2 actor convention and an ISO 8601 datetime for the current content revision.
2. Do not write the legacy v0.1 `timestamp` field.
3. Put provenance in `sources`. Every source entry requires `resource`; add a stable `id` when a body claim uses a footnote such as `[^source-id]`.
4. Do not create a legacy body `# Citations` list. Use `sources` and claim-level footnotes when attribution materially improves trust.
5. Strongly encourage `resource` for a concept describing a canonical asset, API, schema, dataset, package, or external system. Do not invent one for an abstract concept.
6. Add `status`, `stale_after`, `verified`, credibility signals, or attestation fields only when evidence warrants them. Absence is meaningful; never fabricate trust. When `status` is absent, consumers treat the concept as stable.
7. Preserve unknown producer fields.
8. Resolve every changed local link and verify every changed external source for reachability and semantic relevance.

## Choose the operation

### Create or convert

1. Identify the domain, authoritative sources, consumers, and bundle root.
2. Inventory atomic concepts and fix their paths before cross-linking.
3. Write one coherent concept per non-reserved Markdown file.
4. Add `type`, useful descriptive metadata, truthful `generated`, and warranted `sources`.
5. Add concise indexes for progressive disclosure and a log only when useful.
6. Verify links and sources, then validate hard conformance separately from producer-profile errors and warnings.

### Migrate v0.1 to v0.2

1. Read §13 of the current specification.
2. Change the root declaration to `okf_version: "0.2"`.
3. Replace `timestamp` with truthful `generated.by` and `generated.at`.
4. Move final `# Citations` entries into `sources`; split entries containing multiple links into separate sources and retain their titles.
5. Convert logs to one H1 title followed by newest-first `## YYYY-MM-DD` sections.
6. Preserve all other fields and prose, then remove the legacy fields and citation section.
7. Run `node scripts/validate-okf.mjs <bundle-root>` from this skill directory and resolve every error.

### Maintain

1. Inspect changed sources and affected concepts.
2. Update facts and relationships without deleting unknown fields.
3. Refresh `generated.by` and `generated.at` for meaningful content edits.
4. Update `sources` and claim footnotes when provenance changes.
5. Update relevant indexes and record the change as one new Log Entry (see [Record changes and decisions](#record-changes-and-decisions)).
6. Reverify affected links, sources, and fragments.
7. Validate and report hard errors, producer-profile errors, and warnings separately.

### Query

1. Start at the root `index.md`, otherwise inventory paths and frontmatter.
2. Use type, title, description, tags, sources, status, trust, lifecycle, and links to select concepts.
3. Read only the bodies required to answer.
4. Cite concept paths used and distinguish bundle facts from inference.

### Validate

Run the bundled validator with Node.js:

```sh
node scripts/validate-okf.mjs /path/to/bundle
```

For a repository that maintains `Workspace Package` concepts, require complete package coverage and source freshness:

```sh
node scripts/validate-okf.mjs /path/to/bundle --workspace-root /path/to/repository
node scripts/docs-drift.mjs /path/to/repository --markdown drift.md          # repository-wide drift issue body
node scripts/docs-drift.mjs /path/to/repository --pr origin/main --markdown r.md  # advisory pull-request report
```

The validator discovers `apps/*/package.json`, `benches/package.json`, and `packages/*/package.json`. Each manifest requires exactly one `type: Workspace Package` concept whose `workspace_package` and `resource` match; a retired `source_digest` field is a producer-profile error. Freshness is not stored in the bundle, because a stored source hash conflicts on every concurrent change to the same package. `docs-drift.mjs` instead lists, per package, the non-merge commits that changed package source (excluding `.cache`, `node_modules`, `dist`, `target`, and `coverage`) after the last commit that touched its concept, and renders them as one tracking-issue body. Editing a concept, including only its `generated.at` after a review that found it current, clears that package. Both reports include validation findings and exit successfully: they inform review and maintenance rather than gate merges. Drift measurement needs full git history.

Report:

- **Conformance errors:** violations of the three hard requirements.
- **Producer-profile errors:** legacy v0.1 fields, missing or malformed `generated`, malformed source families, invalid or unverified links/sources, or unjustified trust fields.
- **Warnings:** missing recommended metadata, weak navigation, orphan concepts, indirect sources, or potentially stale claims.

## Record changes and decisions

Records are append-only and never share a file, so concurrent changes cannot conflict over them. Create each one with
the scaffolder, which refuses to overwrite an existing subject, then replace every `TODO(docs:new)`; validation rejects
leftover scaffold text.

```sh
node scripts/records.mjs <bundle> new log <slug> <title…>
node scripts/records.mjs <bundle> new decision <slug> <title…>
node scripts/records.mjs <bundle> list log        # or: list decision
```

- A `Log Entry` concept lives at `log/YYYY-MM-DD-<slug>.md`: `title` and `generated` in frontmatter, flat prose in the body, no headings.
- A `Decision` concept lives at `…/decisions/<slug>.md`, named by its subject with no number prefix. It carries `decision_status` (Proposed, Experiment, Deferred, Accepted, or Superseded), a quoted `decided` date, optional `supersedes` (register IDs or decision slugs), and its rule under `## Decision`, followed by `## Why` and `## Consequences`.
- Never number a record from a shared counter, and never add to a shared index; `list` derives the newest-first view.
- A legacy register that declares `frozen_after: D-<n>` accepts no row numbered above it. Existing rows keep their IDs and may still change status.
- A `log.md` that states `frozen history through YYYY-MM-DD` accepts no later date section.

## Handle reserved files

- Root `index.md` may contain only `okf_version: "0.2"` in frontmatter.
- Nested indexes have no frontmatter and provide concise navigation.
- Logs have one H1 title and newest-first `## YYYY-MM-DD` sections with flat prose entries. A bundle that records changes as `Log Entry` files keeps `log.md` as frozen history and adds no new sections to it.
- Never treat `index.md` or `log.md` as concepts.

## Handle provenance and trust

- Use `sources[].resource` for the material a concept derives from.
- Use the actor forms `<producer>/<version>`, `human:<id>`, and `process:<id>` for `generated.by` and `verified[].by` exactly as specified.
- Treat `verified` as `by`/`at` verification history, not a confidence score; consumers accept a bare mapping as a one-item list.
- Derive trust tiers and freshness from the standard fields. Do not store a subjective credibility score.
- Keep each attested computation as its own concept and never let an agent rewrite its sanctioned computation during execution.

## Compose with Diátaxis

Use OKF for portable structure, provenance, trust, and links. Use Diátaxis to decide whether reader-facing material is a tutorial, how-to, reference, or explanation. Keep internal plans, decisions, and schemas in their native formats while representing each as a coherent OKF concept.
