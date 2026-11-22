---
type: Log Entry
title: 'Keep a Scene traversal intact when a Three root leaves it'
generated:
  by: process:docs-new
  at: '2026-11-22T03:31:48Z'
---

Removing a root's last text group made the next `scene.updateMatrixWorld()` throw on the integration branch. The root
unbinds while Three's loop over `scene.children` is running, at its publication object or preparation object, and
removing those two objects shortened the list whose length Three had already counted. The loop then visited
`undefined` or skipped the objects after the root's. The root now places its objects through one path that never
removes a child during a Glyph-owned traversal step: the objects stay, inert, and leave in a microtask once the traversal
has returned. `unregister` and `disposeHost` use the same path, and `unregister` now also releases the Scene's render
hooks and the preparation object instead of leaving them behind. The behavior is described in the
[Three.js text API](../planning/three-api.md) frame section.

Six integration tests cover discovered and attached roots losing their last text before a traversal, from an `onLayout`
callback, and by disposal from an `onLayout` callback; three of them threw before the change, and every one also checks that objects after the root are still traversed. With the fix the
`benchmark:three-storage-lifetime` single, multi, compile, renderer-disposed-first and sibling scenarios pass on Three
0.185.1 and 0.186.1 in Chromium WebGPU and WebGL2.
