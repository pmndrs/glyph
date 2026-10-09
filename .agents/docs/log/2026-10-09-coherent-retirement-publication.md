---
type: Log Entry
title: 'Keep accepted Three publications coherent after retirement failures'
generated:
  by: process:docs-new
  at: '2026-10-09T14:59:58Z'
---

The [Glyph package](../packages/glyph.md) correction for [#275](https://github.com/pmndrs/glyph/issues/275) keeps an
irreversible Three publication accepted when application retirement callbacks throw. Preparation failures still reject
before host mutation. Explicit failure presence preserves arbitrary thrown values, and root-owned error attribution
settles participants before guarded notifications. Lifecycle teardown is blocked during settlement; successful error
clearing reuses the member scratch and retained group ownership rather than copying participants or walking ancestry.

The final correction also preflights detached, unbound Text disposal at the root-membership boundary and removes a
disposing TextGroup from the same root-owned attribution set before clearing its terminal error state. Disposed groups are
excluded from later attribution even if callers retain or reattach their Three nodes; child Text remains readable. Public
regressions prove the unbound Text rejects disposal from an `onError` settlement callback without changing membership,
retains its owned FontFace lease for a public read, then disposes normally, and that a disposed group stays clear and
unnotified through a different group's error and the following success.

An independent final review then found one remaining precedence edge: after accepted error attribution, reentrant
`onError` hierarchy changes could make initial transform synchronization throw and replace the original retirement value.
The accepted hook now attempts that synchronization without letting a secondary transform failure replace an existing
publication failure, and clears its retry flag only after synchronization succeeds. A public two-root regression moves
the first hierarchy between scenes, uses exact retirement values `undefined` and `0`, reparents beneath a throwing
`Object3D` from `onError`, and specifies accepted revisions, exact aggregate ordering and notifications, and later
recovery.

On the earlier `7b845b30` base, inspection and tests confirmed that reused draw updates precede transform commit and the
accepted scope index is installed before retirement callbacks. The required Glyph build, the focused 119-test public Three
and ownership integration run, and the complete `@pmndrs/glyph` check passed there, including the two-root `undefined`/`0`
precedence case, the 931-test primary Node run, TypeScript and static checks, formatting, Rust checks, and the additional
deterministic/fuzz and fixture suites.

The hardening commit was then rebased without conflicts onto `b6ba9947`, which includes PR280's sparse text assignment
implementation and public integration regressions. Read-only diff inspection confirms that the sparse tests, PR279's
accepted-scope retry regression and renderer ordering, and this change's publication/lifecycle regressions remain together
without another publication path. No build, test, package check, Labs, install, or server workflow ran after that rebase;
the earlier results are scoped evidence, not validation of the new combined base. Throwing listeners during final renderer
teardown remain a separate inherited follow-up.

A final independent review found that an `onError` callback could synchronously traverse a reparented scene while the
outer accepted failure was still being attributed. A secondary transform report could then replace the original error
state even though the public shape call still threw the original retirement value. Root attribution is now outermost-only
through state installation and callbacks, preserving the single owner and the accepted classification while nested scene
work returns to the outer notification. The public regression performs that traversal beneath a throwing
`updateWorldMatrix` parent, covers exact `undefined`, `null`, and `0` retirement values across roots, and specifies the
primary aggregate entries, one notification per participant, committed revisions, Text/TextGroup attribution, and later
transform recovery. The retirement regression now compares the accepted and recovered renderer through the existing full
cold differential instead of a draw-shell snapshot.

The branch rebased without conflicts onto docs-only main `e5515024`; inspection retained the #279 renderer ordering and
scope-index regression plus #280's sparse implementation and public tests. Serialized validation of the final correction
passed source, public-fixture, shader, emitted-declaration, and peer-declaration TypeScript checks; touched-file formatting
and lint; the required Glyph build; all 104 focused public Three tests; and all 936 package Node tests. The focused lane
exercised the reentrant callback traversal with exact `undefined`, `null`, and `0` values, accepted Text/TextGroup state,
single primary notifications, deterministic transform recovery, both real disposer types, and the full cold renderer
differential. Authenticated fixture bodies were materialized from the recovery checkout and restored to their exact Git
LFS pointer contents afterward. No Labs, install, server, full package check, or CI workflow ran; exact-artifact publication
Labs, remote CI, and a final independent review of this corrected head remain release gates.

The corrected terminal review of `7fc2918e` was not clear. It found two inherited source-traced gaps that the accepted
publication invariant still had to close: geometry retirement could run callback traversal before the candidate scope
index became authoritative, and an earlier root's notification could mutate a later root's staged revision and traverse
it before that root consumed its already-accepted retirement failure. It also found that the full draw/layout/visibility
oracle did not independently prove which realized material the replacement draw owned.

This source-only correction rebased without conflicts onto `5486a552`, preserving the release-scale visibility coverage.
The renderer now installs candidate draw/scope and resource authority before add/remove/disposal callbacks while retaining
the previous draw array locally for retirement and preserving reused-metadata-before-transform ordering. Root acceptance
uses the revision captured in the existing preparation loop, leaving callback-authored later revisions and measurements
pending. The existing explicit publication-failure wrapper gates only secondary traversal reporting while that root's
primary accepted-retirement settlement is pending. Public regressions specify callback-time hidden geometry replacement,
the exact warm replacement material realization, and a two-root `undefined`/`0` case whose callback update stays pending,
whose secondary throwing transform is not reported, and whose next publication matches a full cold renderer snapshot.
These new source and test changes have not yet been built or executed; the prior validation above does not cover them.
Targeted type/static/format checks, the Glyph build, focused and package Node tests, exact-head independent review, Labs,
and remote CI remain pending.
