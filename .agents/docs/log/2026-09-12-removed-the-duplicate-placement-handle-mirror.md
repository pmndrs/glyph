---
type: Log Entry
title: 'Removed the duplicate placement-handle mirror'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Changed publications now bind positioned segments and build the
root x/y table directly from the placement allocator's prepared assignment slice. The planner no longer reserves,
copies, clears, or retains a second `Vec<PlacementHandle>` containing identical rows; commit and abort still own the
allocator transaction and the session rows independently.
