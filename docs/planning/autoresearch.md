---
type: Optimization Protocol
title: Autoresearch optimization protocol
description: Governs evidence-based optimization experiments that cannot trade away rendering quality or text correctness.
status: deferred-until-baseline
tags: [optimization, benchmarks, quality]
---

# Autoresearch optimization protocol

Status: proposed  
Purpose: allow an optimization agent to search for and preserve proven performance improvements without degrading rendering quality, text correctness, compatibility, or maintainability.

## Mandate

The autoresearch agent may change an implementation only inside a bounded experiment branch or worktree. It may create local evidence commits. It may not push, merge, publish, change accepted quality semantics, weaken tests, or update production baselines without human review.

Its job is not to produce the largest benchmark number. Its job is to discover changes that survive an adversarial comparison with the current implementation.

The first raster target should be Slug because:

- it has the highest V1 optimization difficulty;
- Three Flatland already supplies measured hypotheses and rejected experiments;
- its fill-bound shader has meaningful room for representation, code-generation, and workload-specific improvements;
- bitmap and MTSDF-backed MSDF runtime paths are comparatively conventional.

The same protocol later applies to shaping, baking, paragraph layout, loading, and the other rasters.

## Non-negotiable acceptance rule

An experiment is accepted only when all of the following are true:

1. **Correctness is unchanged.** Conformance output, decoded payload meaning, and renderer behavior remain identical for the declared capability set.
2. **Quality does not regress.** Strict reference images pass across the complete quality guard corpus. A faster approximation is not an optimization under this protocol.
3. **The win exceeds noise.** The relevant end-to-end metric improves by more than the measured confidence/noise threshold in repeated interleaved A/B runs.
4. **Guard workloads do not regress.** A Latin win that loses on CJK, icons, perspective, startup, memory, WebGL, or WebGPU is either rejected or emitted as an explicit build-time variant with zero cost to other workloads.
5. **Costs are reported.** Bundle bytes, payload bytes, bake time, peak memory, GPU memory, startup, and maintainability changes are included where affected.
6. **The result is reproducible.** Raw samples, environment details, fixture hashes, base/candidate commits, and commands are stored with the experiment.

Kernel improvements do not qualify when the product-level path is neutral or slower.

## Explicitly excluded from automatic acceptance

The agent must reject or route for a separate human product decision any change that:

- uses approximate minification or coverage guards;
- lowers curve/texture precision;
- removes a robust root/grazing case;
- changes hinting, antialiasing, stem weight, dilation, or visible bounds;
- shrinks the supported glyph/script/transform range;
- changes output only within a subjective tolerance rather than demonstrating equivalence;
- adds a runtime algorithm branch that forces unused engines or data into the bundle;
- improves one renderer by coupling shaping or paragraph output to that renderer;
- weakens a fixture, raises a tolerance, or replaces a reference image as part of the same experiment.

These may still be valid product modes, but they belong in a separately reviewed quality/performance tradeoff lane.

## Required experiment manifest

Every run starts from a small checked-in manifest:

```yaml
id: slug-adaptive-bands-cjk-001
owner: autoresearch
baseCommit: <immutable commit>
target: raster/slug
hypothesis: Adaptive per-glyph bands reduce dense glyph curve visits without affecting output.
changedVariables:
  - band selection policy
primaryWorkloads:
  - cjk-dense
guardWorkloads:
  - latin-ui
  - arabic-marks
  - icons-complex
  - svg-loose-curves
  - perspective
backends:
  - webgpu
  - webgl2
qualityPolicy: exact
metrics:
  - gpu_ms
  - raster_bytes
  - bake_ms
  - gpu_memory_bytes
```

The exact schema will be implemented with the benchmark harness. The important constraint is that the agent cannot redefine the target, workloads, or acceptance rule after observing the result.

## Optimization loop

For each hypothesis:

1. **Select one variable.** Do not combine unrelated optimizations in one experiment.
2. **Validate the baseline.** Confirm the base commit is green and collect fresh noise/variance samples.
3. **Implement minimally.** Keep the change small enough to attribute the outcome.
4. **Run correctness first.** Abort performance measurement on any conformance, payload, shader-validation, or visual failure.
5. **Inspect generated output.** For shader/compiler work, record generated WGSL/GLSL/Wasm or relevant intermediate output instead of assuming source structure equals executed work.
6. **Run interleaved A/B.** Randomize or alternate immutable base and candidate builds after warmup; disable vsync where possible and control viewport, DPR, power, and thermal conditions.
7. **Test the whole guard matrix.** Include both target rendering backends and dense/sparse source classes when applicable.
8. **Calculate the decision.** Compare medians and tails with the measured dispersion and confidence interval. The initial provisional performance gate is at least 5% end-to-end improvement and clearly outside the 95% confidence/noise interval; Phase 1 may revise this from actual harness variance.
9. **Keep or discard.** A passing result receives one local evidence commit. A failing result is reverted and recorded in the rejected-hypothesis log so it is not rediscovered repeatedly.
10. **Request human review.** The agent reports the evidence and waits. It never pushes or merges the result itself.

## Quality guard corpus

The Slug corpus must include at minimum:

- simple and feature-heavy Latin;
- Arabic marks and cursive forms as shaped glyph inputs;
- dense CJK glyphs;
- icon fonts and intricate SVG outlines;
- loose-control quadratic curves;
- holes, overlaps, self-intersections, and supported fill rules;
- grazing/tangent and nearly linear quadratics;
- tiny, ordinary, and very large projected sizes;
- minification and deep magnification;
- rotations, non-uniform scale, shear/perspective cases supported by the renderer;
- WebGPU and WebGL2 outputs;
- stroke and decoration paths where shared shader code is affected.

Reference tests must distinguish deterministic binary equality, exact mathematical/reference equality, and unavoidable cross-device raster variation. Cross-device variation is characterized before an experiment; it is never used to excuse a new candidate-only artifact.

## Evidence artifact

Each completed experiment stores:

```text
autoresearch/<experiment-id>/
  manifest.yaml
  result.md
  environment.json
  raw/
  generated/
  images/
  diffs/
```

`result.md` records:

- accepted, rejected, inconclusive, or variant-only;
- base and candidate commits;
- complete metric table with dispersion;
- quality/conformance result;
- payload/startup/memory effects;
- explanation of why the result follows from the evidence;
- next hypothesis, if any.

Large raw artifacts may use an external immutable artifact store later, but their hashes and retrieval instructions remain in the repository.

## Initial Slug hypothesis queue

### Baseline-port queue

These were already measured or structurally validated in the Three Flatland fork and should be reproduced in the new architecture before novel search begins:

1. dynamic curve loops;
2. generated-shader expression and loop-invariant hoisting;
3. structural branches instead of eager expensive selection;
4. exact compact band headers/references;
5. complete identical-band-list deduplication;
6. exact quadratic ink bounds.

They still require new-repository evidence because the format, shader generator, hardware, and renderer integrations will differ.

### Research queue

1. adaptive per-glyph band counts, starting with the CJK/dense corpus;
2. a build-time hull-assisted band variant for sources where it wins without a Latin cost;
3. per-root branch structure after measuring divergence on both backends;
4. source-class-specific packing chosen at bake time with explicit payload metadata;
5. overdraw and batching improvements that preserve the raster-independent layout contract;
6. atlas paging and residency strategies for broad CJK coverage.

### Known rejected or separate-lane ideas

- approximate Windfoil-style minification guard;
- a less robust quadratic solver with grazing differences;
- reduced antialiasing skirt/dilation;
- lower curve precision;
- runtime selection between complete Slug and Windfoil shaders;
- universal hull/adaptive-band formats before dense-source evidence.

## Human review packet

The agent's final message for an accepted experiment must contain:

- one-sentence hypothesis and outcome;
- exact end-to-end improvement and confidence/noise context;
- confirmation of the full quality and conformance gate;
- any size, startup, bake, memory, or compatibility changes;
- local commit and artifact paths;
- explicit statement that nothing was pushed or merged.

The maintainer then chooses whether the evidence commit enters an implementation branch. Autoresearch evidence informs decisions; it does not make product decisions.
