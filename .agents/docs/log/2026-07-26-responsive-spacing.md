---
type: Log Entry
title: 'Responsive spacing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected the form-control font reset that silently overrode every explicit Tailwind text size, restoring 10–12 px button and field labels with unclipped 28 px-or-taller controls. The desktop three-column shell now begins only when its rail, scene, and controls fit at 1,200 px; 1,024 px uses the full-width bottom-navigation flow. Narrow scene headers stack their chips, startup cards use two columns, and live-state labels keep reserved breathing room. The maintained browser probe now rejects horizontal overflow, oversized or clipped control labels, crowded control heights, and incorrect tablet/desktop navigation at 390, 1,024, and 1,280 CSS pixels.
