---
type: Log Entry
title: 'Presentation control dock'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the expandable form panel and application-owned listbox behavior with official shadcn components backed by Base UI. A viewport-anchored segmented dock exposes one contextual popover per dynamic workload control, uses multiline panels for selection and text entry, omits unavailable technique controls, and retains Koota as the single app-boundary state owner. Base UI now owns outside press, Escape, focus restoration, portal positioning, and keyboard behavior. Presentation surfaces share tighter corners; MTSDF paint defaults to zero stroke with shadow off.
