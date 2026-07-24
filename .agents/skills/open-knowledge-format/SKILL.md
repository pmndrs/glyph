---
name: open-knowledge-format
description: Create, convert, inspect, query, validate, or maintain Open Knowledge Format (OKF) knowledge bundles made from linked Markdown concept files with YAML frontmatter. Use when the user mentions OKF, Open Knowledge Format, knowledge bundles, LLM wikis, portable agent knowledge, OKF conformance, or asks to make repository knowledge interoperable across human and agent tools. Do not use for ordinary Markdown documentation unless OKF compatibility or a knowledge bundle is requested.
---

# Open Knowledge Format

Apply the upstream OKF specification faithfully while keeping the bundle useful to humans and agents. OKF is a transport and interoperability format, not a prescribed domain taxonomy or replacement for OpenAPI, schemas, ADR formats, or documentation methods such as Diátaxis.

Read [references/okf-v0.1.md](references/okf-v0.1.md) before designing or validating a bundle. OKF v0.1 is a draft; when exact conformance matters and internet access is available, verify the current [upstream specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

## Preserve the interoperability contract

Establish the bundle root before validating it. Only Markdown files inside that directory belong to the bundle; do not impose OKF concept rules on repository files outside it.

Treat only these as hard v0.1 conformance requirements:

1. Every non-reserved Markdown concept file has parseable YAML frontmatter.
2. Every concept frontmatter block has a non-empty `type` field.
3. Reserved `index.md` and `log.md` files follow their specified structures when present.

Treat titles, descriptions, timestamps, indexes, logs, citations, and working links as quality recommendations unless the upstream specification says otherwise. Never reject a bundle merely because it contains unknown types or fields, missing optional metadata, a missing index, or a broken link.

## Apply the authoring profile

Keep upstream conformance distinct from this skill's stricter producer policy:

1. Require `timestamp` on every concept document authored or maintained with this skill.
2. Set it to an ISO 8601 datetime for the last meaningful edit, refresh it whenever the concept body or frontmatter changes, and always place it as the final field in the YAML frontmatter.
3. Strongly encourage `resource` when the concept describes a canonical asset, API, schema, dataset, package, or external system. Omit it for abstract concepts rather than inventing a URI.
4. Require a final `# Citations` section whenever the concept makes claims derived from external or internal source material. Cite the source directly in the concept; a separate bibliography does not satisfy this requirement by itself.
5. Use numbered citation entries in the form `[1] [OpenType specification](https://learn.microsoft.com/en-us/typography/opentype/spec/) — normative font-layout source.` Internal bundle concepts and repository files are valid sources when they are authoritative for the claim.
6. Require every link and citation to be real, reachable, correctly targeted, and semantically relevant when authored or edited. A syntactically valid URL or HTTP success alone is insufficient.
7. Report a missing or malformed `timestamp`, missing required citations, or an unverified/invalid link as an authoring-profile error rather than an OKF conformance error.

## Choose the operation

### Create or convert a bundle

1. Identify the knowledge domain, authoritative sources, intended consumers, and bundle root.
2. Inventory atomic concepts before writing files. Use one concept per non-reserved Markdown file.
3. Fix the proposed paths before adding cross-links; the path without `.md` is the concept ID.
4. Preserve source material and record uncertainty. Do not invent facts, resources, timestamps, relationships, or citations.
5. Add the required `type` and warranted optional metadata. Add `resource` whenever a canonical URI exists, then add the authoring-profile `timestamp` as the final frontmatter field.
6. Express relationships with normal Markdown links and explanatory surrounding prose.
7. Add a final numbered `# Citations` section for every source-backed concept.
8. Add concise indexes for progressive disclosure and a log only when they add value.
9. Verify every internal and external link, including citation relevance, then validate hard conformance separately from authoring-profile requirements and producer-quality warnings.

### Maintain a bundle

1. Inspect the changed sources and the affected concepts.
2. Update facts and relationships without deleting unknown producer-defined fields.
3. Refresh the concept's `timestamp` to the time of the meaningful edit and keep it as the final frontmatter field.
4. Add or correct `resource` when the concept has a canonical URI.
5. Add or update the final numbered `# Citations` section when sourced claims change.
6. Reverify every changed link and citation target, plus links affected by moved concepts or upstream redirects.
7. When moving a concept, update inbound links across the bundle.
8. Update relevant indexes and add a newest-first log entry if the bundle uses logs.
9. Avoid rewriting historical log entries solely to repair links to moved concepts.
10. Revalidate and report conformance errors, authoring-profile errors, and warnings separately.

### Query a bundle

1. Start at the root `index.md` when present; otherwise inventory paths and frontmatter.
2. Use `type`, `title`, `description`, tags, and links to select relevant concepts.
3. Read only the bodies needed to answer the question.
4. Cite the concept paths used and distinguish bundle facts from inference.

### Validate a bundle

Report three levels:

- **Errors:** violations of the three hard conformance requirements.
- **Authoring-profile errors:** missing or malformed concept timestamps, missing final citations for source-backed claims, or invalid/unverified links and citations.
- **Warnings:** missing recommended metadata, orphan concepts, weak navigation, indirect sources where a primary source is available, or potentially stale claims.

Do not label producer-quality warnings as spec violations. Fix warnings when the user requests a production-quality bundle, while preserving the consumer's permissive behavior.

## Author concept files

Use the minimal valid shape:

```markdown
---
type: Component
title: Font Shaper
description: Converts styled Unicode runs into positioned glyphs.
timestamp: 2026-07-24T13:15:24Z
---

The font shaper consumes validated OpenType layout data.

# Citations

[1] [OpenType specification](https://learn.microsoft.com/en-us/typography/opentype/spec/) — normative font-layout source.
```

Apply metadata deliberately:

- `title`: human-readable display name;
- `description`: one-sentence summary;
- `timestamp`: required by this skill; ISO 8601 time of the last meaningful edit and always the final frontmatter field;
- `resource`: strongly encouraged canonical URI when the concept describes an identifiable asset or system;
- `tags`: short cross-cutting labels;

Preserve all unknown fields during edits. Use descriptive free-form types and tolerate types the consumer does not recognize.

## Handle reserved files

- Use `index.md` for concise navigation and progressive disclosure.
- Use `log.md` for newest-first dated history with `YYYY-MM-DD` headings.
- Do not treat either reserved filename as a concept.
- Permit frontmatter in the bundle-root `index.md` only to declare `okf_version: "0.1"`.
- Never add frontmatter to a nested `index.md`.
- Keep long explanations in concept files and link to them from indexes.

## Link and cite responsibly

- Use standard Markdown links with `.md` for concept targets.
- Prefer bundle-root-relative links for cross-directory relationships and relative links for nearby concepts.
- Explain the relationship in prose; OKF links are directed but untyped.
- Put source-backed claims under a final `# Citations` section when appropriate.
- Treat that section as mandatory under this authoring profile whenever source-backed claims are present.
- Number entries and cite the most direct authoritative source available.
- Do not rely on a repository-wide bibliography as a substitute for concept-local attribution.
- Prefer links over duplicated knowledge, but do not fragment one coherent concept into trivia-sized files.
- Never include credentials, secrets, or access tokens.

### Verify links and citations

- Resolve every repository-local path from the containing document and verify that the file or directory exists.
- Verify local Markdown fragments against an actual heading or explicit anchor in the target document.
- For external HTTP(S) targets, follow redirects and confirm a successful response with a bounded request. Retry with a normal GET when a server does not support HEAD.
- Treat authentication requirements, bot protection, rate limiting, DNS failures, and timeouts as unresolved verification—not as proof that a target is missing. Report them and use another authoritative access path when possible.
- Inspect the destination, not only its status code. Confirm the page, file, revision, issue, specification section, or repository is the intended source and supports the claim attributed to it.
- Prefer immutable revision links for implementation evidence and current canonical links for living specifications.
- Check URL fragments separately because HTTP responses do not validate client-side anchors.
- Remove or replace links that are genuinely missing, misleading, superseded without value, or unrelated to their surrounding claim.

## Compose with Diátaxis

Use OKF to make a knowledge collection portable and connected. Use Diátaxis to decide how a reader-facing documentation page should serve a user. A concept may link to tutorials, how-to guides, reference, explanations, ADRs, schemas, or source code without absorbing those formats.

## Final check

- Confirm the bundle root and every concept ID.
- Confirm one coherent concept per concept file.
- Validate frontmatter and non-empty types.
- Require a valid timestamp, confirm it reflects the current meaningful edit, and confirm it is the final frontmatter field.
- Confirm applicable resource-backed concepts identify their canonical URI.
- Confirm every source-backed concept ends with a numbered `# Citations` section.
- Verify all local targets and anchors, all external destinations and redirects, and the semantic relevance of every citation.
- Validate reserved-file structure.
- Preserve unknown metadata.
- Check links, citations, indexes, and logs as producer-quality concerns.
- Report assumptions and gaps instead of filling them with invented content.
