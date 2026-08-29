# Core planner and render-plan vocabulary migration

The long-lived backend child is a `RenderPlanner`: it owns `RetainedText` inputs, policy selection, capacities, target,
revisions, and one acceptance frontier. Each `publish()` emits a transient `RenderPlan` candidate. Do not call the planner
a plan, and do not call emitted plan records retained records.

```ts
const planner = backend.createPlanner({ policy, target, limits, ...capacities });
const text = planner.createText({ font, text: 'Hello' });
const result = planner.publish();
```

`RenderPlanner` is the normal synchronous type. `AsyncRenderPlanner` is selected only by an `AsyncPlanTarget`, and
`RenderPlanTarget` is their target union. Plan
readers, views, records, patches, and reader functions use the `RenderPlan` prefix. Statuses that can arise while binding
policies, fonts, or planners use the `GlyphEngine` prefix. Planner-only backpressure uses `RenderPlanner`; asynchronous
buffer-contract failures use `PlanTransport`.

The planner wire handle and pre-alpha Rust/Wasm ABI change in the same release: `plannerId`, `createPlanner`,
`reservePlanner`, `disposePlanner`, `plannerCount`, `plannerConflict`, and `plannerMissing`. No retained-plan ABI aliases
survive. Calls that pass the old `retained-plan` ID kind are rewritten to `planner`; unrelated application strings are
not. JavaScript consumers that inspect status codes must manually migrate `retained-plan-conflict` and
`retained-plan-missing` to `planner-conflict` and `planner-missing`.

The transform covers TypeScript, TSX, MTS, JavaScript, and MJS identifiers, local planner names, and the package-internal
`render-planner.ts` move. Do not rename historical decision prose or unrelated renderer sessions. Regenerate the ABI
from Rust, then typecheck consumers and exercise synchronous, asynchronous, backpressure, disposal, collision, and
malformed-frame tests.
