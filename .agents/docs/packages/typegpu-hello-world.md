---
type: Workspace Package
title: '@pmndrs/glyph-typegpu-hello-world'
description: Demonstrates retained bitmap, MSDF, and Slug text rendering in caller-owned TypeGPU passes.
resource: ../../../apps/typegpu-hello-world
workspace_package: '@pmndrs/glyph-typegpu-hello-world'
documentation_type: reference
source_digest: 'sha256:de45152cc0af49d9622b23851447cffc57434312840b5c0cfa2534742d2980bd'
tags: [package, example, typegpu, webgpu, vite]
sources:
  - id: manifest
    resource: ../../../apps/typegpu-hello-world/package.json
    title: Application manifest
  - id: app
    resource: ../../../apps/typegpu-hello-world/src/main.ts
    title: Caller-owned TypeGPU root and render pass
  - id: integration
    resource: ../../../packages/glyph/src/typegpu.ts
    title: Public TypeGPU integration
  - id: probe
    resource: ../../../apps/typegpu-hello-world/scripts/live-check.probe.ts
    title: GPU pixel and update verification
generated:
  by: openai-codex/gpt-6
  at: '2026-09-07T00:00:00Z'
---

# Package reference: `@pmndrs/glyph-typegpu-hello-world`

This Vite application uses `defineTypeGpuConfig`, `handle.createText()`, `glyph.shape()`, and `handle.draw()` from public
Glyph exports. It owns its TypeGPU root, canvas context, command encoder, pass attachments, and queue submission.
Reusable shader functions come from the explicit `@pmndrs/glyph/shaders/typegpu` sibling; native Three.js Shading
Language functions remain isolated at `@pmndrs/glyph/shaders/tsl`.
The UI edits content, font size, color, raster format, and tilt. The tilt uniform drives optional GPU position and color
callbacks without reshaping. Those callbacks read an explicit bind group supplied through `handle.with(animationGroup).draw(...)`. Its compact purple/blue interface explains direct WebGPU rendering without a Three.js scene or camera,
identifies shaders as TypeScript functions, and links to https://typegpu.com. A footer explains the tilt control and baked bitmap strike.
A ResizeObserver redraws at the canvas's current pixel ratio.
No frame loop runs while the page is idle.

The example owns the Inter GLB and its license in `assets/`; its build emits that local license alongside
assets. The browser probe imports the startup promise directly, without globals or custom readiness events. Bitmap explicitly selects the baked 32 px strike; MSDF and Slug use their baked resources.

`typegpu:dev` starts the development server. `typegpu:live-check` builds the app, launches Chromium with WebGPU, and checks
pixel output, retained idle draws, text changes, empty text, and that caller commands can follow Glyph in the same pass.
Custom callback checks cover uniform-driven perspective and color changes, fragment coordinates, depth occlusion,
offscreen clipping, and isolation from the default config across all three raster formats. Explicit bind-group checks
verify chaining, last-group replacement, immutable parent views, missing groups, named roots, and saved-view disposal.
The test requires its explicit completion marker and propagates browser-probe failure to the shell.
The retained-reflow case also exercises the shared f32x2 placement table and per-occurrence placement slot for Bitmap,
MTSDF, and Slug while the caller-owned callback groups remain active; the direct adapter remains a proof-of-concept rather
than a constraint on the renderer-neutral buffer layout.
An analytic MSDF readback checks fill and shadow coverage at 0, 45, and 90 degrees against an independently derived
constant-coverage value. The former `fwidth` footprint is rendered alongside as a negative control that must disagree
at 45 degrees. No golden image regeneration is involved.
