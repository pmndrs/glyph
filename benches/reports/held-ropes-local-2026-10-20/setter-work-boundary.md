# Setter-only timing boundary

Source-only interpretation; this note does not exclude or reclassify measured slower rows.

The current prepared-operations.bench.ts generator times alternating target.text assignments for the `set` operation and returns immediately. It performs no timed measure or scene publication in that operation. Siblings and cold expected results are prepared outside timing. Separate set+measure, set+measure+scene-publication and overwrite-before-publication operations exist.

Authenticated main 4e25a96a's render-planner.ts \_updateText validates aggregate limits, adopts the desired state, marks semanticDirty, clears cached measurement/inspection and returns. It does not call the semantic preparation routine in this setter path. Current runtime 273's corresponding \_updateText calls #ensureEngineRebuilt and #prepareTextCandidate before adopting the prepared state. The Three Text setter reaches these paths through stageUpdate, #stage, ConfiguredTextController.update and retained text update. Thus the setter-only operations have different amounts of required work inside the timer. Synchronous preparation is an explicit retained requirement; removing it to match the legacy setter timing would violate scope.

Keep all raw setter-only latencies and slower classifications visible. Assess the complete query/publication transaction rows alongside them; do not use this semantic distinction to erase dense scene-publication regressions or claim parity. A blanket full-matrix parity claim needs an explicit reconciliation of this contract difference, not a favorable post-hoc exclusion.
