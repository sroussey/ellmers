<!--
  @license
  Copyright 2026 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# EntitlementProfile Contract Conformance — Design

## Background

Three of the five contract suites planned in
`docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`
have shipped (AiProvider, ITabularStorage extensions, IMigrationRunner). This
document specifies the fourth: **EntitlementProfile**.

Today the entitlement system in `@workglow/task-graph` exposes three named
grant configurations — `"browser"`, `"desktop"`, `"server"` — that all reduce
to a single `createPolicyEnforcer` implementation. They are not separate
adapter implementations; they are different inputs to one function. Downstream
consumers (e.g. workflow-builder's Electron/web/server packages) layer
platform-specific behavior on top of these grant lists, but there is no
library-level contract that those layered profiles must satisfy.

This proposal introduces a profile abstraction (`IEntitlementProfile`),
extends the entitlement API with single-key requests and
revocation/grant change events sourced from a pluggable signal port
(`IEntitlementSignalSource`), and ships a parameterized conformance suite
that any profile implementation — built-in or downstream — must pass.

## Goals

1. Make "profile" a first-class abstraction with a stable contract that
   library and downstream implementations can satisfy.
2. Add a single-key `requestEntitlement` API whose verdict shape is uniform
   across implementations.
3. Add an observable change-event mechanism so consumers can react when a
   previously-granted entitlement is revoked (or vice versa).
4. Decouple the *source* of permission changes from the profile by
   introducing a pluggable `IEntitlementSignalSource` port.
5. Ship a parameterized conformance suite (matching the AiProvider pattern
   in `packages/test/src/contract/`) that exercises every profile
   implementation against a shared invariant set.

## Non-goals

- Replacing or removing `IEntitlementEnforcer`. The profile interface
  *extends* it; ad-hoc enforcers (`PERMISSIVE_ENFORCER`,
  `createGrantListEnforcer`, `createScopedEnforcer`) keep the simpler
  surface.
- Defining new well-known entitlements. The set in
  `TaskEntitlements.Entitlements` stays as-is.
- Changing the JSON serialization of tasks or graphs.
- Shipping platform-specific signal sources (Electron, browser Permissions
  API, server config reload). Those live in the consumer packages. This
  spec only defines the port and a static no-op default.
- Re-running every existing assertion in `Entitlements.test.ts` through the
  conformance suite. The 1208-line existing file covers the underlying
  primitives (`entitlementCovers`, `evaluatePolicy`, `mergeEntitlements`,
  scoped/grant-list enforcers). The new suite tests profile-level
  invariants only.

## Library API additions

All additions live in `@workglow/task-graph`. Existing exports are unchanged
in shape; one return type widens additively.

### `EntitlementVerdict`

A discriminated union that mirrors `checkAll` semantics for a single
required entitlement.

```ts
export type EntitlementVerdict =
  | { readonly outcome: "granted"; readonly entitlement: TaskEntitlement }
  | { readonly outcome: "denied"; readonly denial: EntitlementDenial };
```

Semantics:

- A **non-optional** required entitlement that the policy denies (any
  reason in `EntitlementDenialReason`) maps to
  `{ outcome: "denied", denial }`.
- An **optional** required entitlement always maps to
  `{ outcome: "granted", entitlement }` regardless of the underlying
  policy verdict — matching the existing rule that optional entitlements
  are filtered out of `checkAll`'s denial list.
- An `"ask"` verdict is resolved internally via the registered
  `IEntitlementResolver` before the function returns; the caller only
  ever sees `granted` or `denied`.

### `IEntitlementSignalSource` and `EntitlementSignal`

A port that produces signals about external permission changes. Profiles
subscribe to a source on construction and translate signals into change
events.

```ts
export type EntitlementSignal =
  | { readonly kind: "revoke"; readonly entitlement: TaskEntitlement }
  | { readonly kind: "grant"; readonly entitlement: TaskEntitlement }
  | { readonly kind: "reload" };

export interface IEntitlementSignalSource {
  subscribe(listener: (signal: EntitlementSignal) => void): () => void;
}

export const STATIC_SIGNAL_SOURCE: IEntitlementSignalSource;
```

`STATIC_SIGNAL_SOURCE` is a frozen no-op singleton: its `subscribe`
returns a no-op unsubscribe and never invokes the listener. It is the
default source for the three built-in profiles, which model immutable
grant lists. Downstream packages provide their own implementations
(e.g., wrapping Electron `permission-request` events).

A `kind: "reload"` signal means "the underlying policy may have changed
in arbitrary ways; consumers should re-query." Profiles translate
`reload` into per-entitlement change events for any entitlement whose
verdict actually flipped (see *Change-event derivation* below).

### `IEntitlementProfile`

```ts
export type EntitlementChangeEvent = {
  readonly kind: "revoked" | "granted";
  readonly entitlement: TaskEntitlement;
};

export interface IEntitlementProfile extends IEntitlementEnforcer {
  readonly name: string;
  surface(): readonly EntitlementGrant[];
  requestEntitlement(required: TaskEntitlement): Promise<EntitlementVerdict>;
  subscribe(listener: (event: EntitlementChangeEvent) => void): () => void;
  dispose(): Promise<void>;
}
```

- `name` — a free-form identifier for diagnostics. Built-ins return
  `"browser"`, `"desktop"`, `"server"`.
- `surface()` — the maximum set of entitlements this profile may grant.
  Returned as `readonly EntitlementGrant[]` so downstream profiles can
  advertise resource-scoped grants. The conformance suite uses this for
  the surface-coverage invariant: every granted entitlement must be
  covered by something in `surface()`.
- `requestEntitlement(required)` — single-key request returning the
  verdict shape above.
- `subscribe(listener)` — register for change events; returns an
  unsubscribe function. The unsubscribe must be idempotent.
- `dispose()` — release resources, including unsubscribing from the
  signal source. Must be idempotent.

### Change-event derivation

When the signal source emits:

| Signal             | Profile behavior                                                                 |
| ------------------ | -------------------------------------------------------------------------------- |
| `revoke(e)`        | Re-evaluate `e`; if previous verdict was `granted` and current is `denied`, emit `{ kind: "revoked", entitlement: e }`. |
| `grant(e)`         | Re-evaluate `e`; if previous verdict was `denied` and current is `granted`, emit `{ kind: "granted", entitlement: e }`. |
| `reload`           | The profile re-evaluates *every* entitlement it has previously been queried about (tracked in a private set) and emits change events for any whose verdict flipped. |

The "previously queried" tracking exists only to scope `reload` work; it
is not visible through the public API. Built-in profiles (with
`STATIC_SIGNAL_SOURCE`) never receive signals and therefore never emit
change events.

### `createProfileEnforcer` widening

Today:

```ts
export function createProfileEnforcer(
  profile: EntitlementProfile,
  resolver?: IEntitlementResolver
): IEntitlementEnforcer;
```

After:

```ts
export interface CreateProfileOptions {
  readonly resolver?: IEntitlementResolver;
  readonly signalSource?: IEntitlementSignalSource;  // defaults to STATIC_SIGNAL_SOURCE
}

export function createProfileEnforcer(
  profile: EntitlementProfile,
  options?: CreateProfileOptions
): IEntitlementProfile;
```

The two-argument legacy form (`createProfileEnforcer(profile, resolver)`)
is dropped; the single-argument form continues to work. Call sites that
pass a resolver migrate to the options-bag form. There is one such call
site to migrate: `globalServiceRegistry.registerInstance(...)` examples
in docs and any internal usage discovered during implementation.

The return type widens from `IEntitlementEnforcer` to
`IEntitlementProfile`, which is a superset; consumers that store the
result as `IEntitlementEnforcer` are unaffected.

`getProfileGrants` and `createProfilePolicy` are unchanged.

## Conformance suite

Lives in `packages/test/src/contract/entitlement-profile/`, mirroring the
AiProvider layout (`packages/test/src/contract/ai-provider/`).

### Layout

```
packages/test/src/contract/entitlement-profile/
  types.ts
  fixtures.ts
  runEntitlementProfileConformance.ts
  assertions/
    surfaceCoverage.ts
    hierarchyHonoring.ts
    resourceScoping.ts
    optionalNeverDenied.ts
    denialShape.ts
    requestEntitlementShape.ts
    subscribeRevocation.ts
    subscribeGrant.ts
    subscribeReload.ts
    unsubscribeIdempotent.ts
    dispose.ts
```

### `types.ts`

```ts
export interface EntitlementProfileConformanceOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<EntitlementProfileConformanceHandle>;
  readonly capabilities: {
    readonly mutableSignalSource: boolean;
    readonly hierarchyHonoring: boolean;     // true for all built-ins
    readonly resourceScoping: boolean;       // true if profile supports scoped grants
  };
  readonly expected: {
    /** IDs that must appear in the profile's surface(). */
    readonly surfaceIncludes: readonly EntitlementId[];
    /** IDs that must NOT appear in the profile's surface(). */
    readonly surfaceExcludes: readonly EntitlementId[];
  };
}

export interface EntitlementProfileConformanceHandle {
  readonly profile: IEntitlementProfile;
  /**
   * Only present when capabilities.mutableSignalSource is true.
   * Pushes a signal as if the underlying source emitted it.
   */
  simulateSignal?(signal: EntitlementSignal): void;
  dispose(): Promise<void>;
}
```

### `fixtures.ts`

Provides constant `TaskEntitlement` values used across assertions:

- `NETWORK_HTTP_REQUIRED` — `{ id: "network:http", reason: "..." }`
- `FILESYSTEM_REQUIRED` — `{ id: "filesystem", reason: "..." }`
- `OPTIONAL_CREDENTIAL` — `{ id: "credential", optional: true }`
- `SCOPED_FILESYSTEM_TMP` — `{ id: "filesystem:read", resources: ["/tmp/*"] }`
- `UNCOVERED_FOO` — `{ id: "foo:bar", reason: "guaranteed not in any built-in profile" }`

These are imported by assertion files; per-shim fixtures are not needed.

### `runEntitlementProfileConformance.ts`

```ts
export function runEntitlementProfileConformance(
  opts: EntitlementProfileConformanceOpts
): void {
  describe.skipIf(opts.skip)(`EntitlementProfile conformance: ${opts.name}`, () => {
    let handle: EntitlementProfileConformanceHandle | undefined;
    const getHandle = () => {
      if (!handle) throw new Error("conformance handle not initialized");
      return handle;
    };

    beforeAll(async () => { handle = await opts.factory(); }, opts.timeout);
    afterAll(async () => { if (handle) await handle.dispose(); });

    surfaceCoverageBlock(opts, getHandle);
    hierarchyHonoringBlock(opts, getHandle);
    resourceScopingBlock(opts, getHandle);
    optionalNeverDeniedBlock(opts, getHandle);
    denialShapeBlock(opts, getHandle);
    requestEntitlementShapeBlock(opts, getHandle);
    subscribeRevocationBlock(opts, getHandle);
    subscribeGrantBlock(opts, getHandle);
    subscribeReloadBlock(opts, getHandle);
    unsubscribeIdempotentBlock(opts, getHandle);
    disposeBlock(opts, getHandle);
  });
}
```

### Assertions

| Block | Asserts | Gated on capability? |
| --- | --- | --- |
| `surfaceCoverage` | For every grant returned from `surface()`, calling `requestEntitlement` for an entitlement covered by that grant returns `outcome: "granted"`. For `UNCOVERED_FOO`, returns `outcome: "denied"` with `denial.reason === "default-deny"`. | always |
| `hierarchyHonoring` | If `surface()` includes a parent ID (e.g., `"network"`), `requestEntitlement` for a child ID (`"network:http"`) returns granted. | `hierarchyHonoring` |
| `resourceScoping` | If `surface()` includes a scoped grant (`{ id, resources: ["/tmp/*"] }`), `requestEntitlement` for an entitlement requiring `"/tmp/x"` is granted; for `"/etc/x"` is denied. | `resourceScoping` |
| `optionalNeverDenied` | `requestEntitlement(OPTIONAL_CREDENTIAL)` returns `outcome: "granted"` even when `credential` is not in `surface()`. Also: `checkAll({ entitlements: [OPTIONAL_CREDENTIAL] })` returns `[]` regardless of policy. | always |
| `denialShape` | `requestEntitlement(UNCOVERED_FOO)` returns `denial` whose `reason` is one of `policy-deny`/`default-deny`/`user-deny` and whose `entitlement` is reference-equal to the input. The discriminated-union invariant for `matchedRule` holds. | always |
| `requestEntitlementShape` | For the same input, `requestEntitlement` and `checkAll([input])` agree: granted ↔ empty denial array; denied ↔ single-element denial array with matching `reason` and `matchedRule`. | always |
| `subscribeRevocation` | After `simulateSignal({ kind: "revoke", entitlement: NETWORK_HTTP_REQUIRED })`, the listener receives `{ kind: "revoked", entitlement: NETWORK_HTTP_REQUIRED }` exactly once *if* the entitlement was previously granted; otherwise no event. | `mutableSignalSource` |
| `subscribeGrant` | Symmetric: a `grant` signal for a previously-denied entitlement produces `{ kind: "granted", ... }`; for an already-granted one, no event. | `mutableSignalSource` |
| `subscribeReload` | After querying entitlements `A`, `B`, `C` and then signalling `reload`, change events fire only for entitlements whose verdict flipped between the previous query and the current one. | `mutableSignalSource` |
| `unsubscribeIdempotent` | Calling the unsub function twice does not throw. After unsub, no further events are delivered to that listener. | `mutableSignalSource` |
| `dispose` | `dispose()` is idempotent (two calls succeed). After `dispose`, the handle's signal source no longer drives events through the profile (call `simulateSignal`; assert listener does not fire). | `mutableSignalSource` for the post-dispose simulation; idempotency assertion always runs. |

Each assertion file exports one block function (e.g.
`surfaceCoverageBlock(opts, getHandle)`) following the AiProvider
pattern. Blocks always call `describe.skipIf(...)` when their capability
gate is off; they never silently skip.

### Adapter shims

```
packages/test/src/test/entitlement-profile/
  Browser_Profile.integration.test.ts
  Desktop_Profile.integration.test.ts
  Server_Profile.integration.test.ts
  Custom_Profile.integration.test.ts
```

Each is ~30 LOC: imports, factory, capability flags, expected surface.
Example sketch for `Browser_Profile`:

```ts
runEntitlementProfileConformance({
  name: "browser",
  timeout: 5_000,
  factory: async () => {
    const profile = createProfileEnforcer("browser");
    return {
      profile,
      dispose: () => profile.dispose(),
    };
  },
  capabilities: {
    mutableSignalSource: false,
    hierarchyHonoring: true,
    resourceScoping: true,
  },
  expected: {
    surfaceIncludes: ["network:http", "ai", "credential"],
    surfaceExcludes: ["filesystem", "code-execution", "mcp:stdio"],
  },
});
```

The `Custom_Profile` shim constructs a profile with a controllable
in-memory signal source (a thin helper exported from the conformance
suite as `createControllableSignalSource()` in `fixtures.ts` *or* defined
inline in the shim — TBD by writing-plans). It enables
`mutableSignalSource: true` and is the only shim that exercises the
subscribe/* assertions. Its expected surface is whatever grant list it
is constructed with — this shim primarily proves that a downstream
profile pattern works.

## Inclusion-lattice test

A separate, non-parameterized test asserts the cross-profile relation:

```
BROWSER_GRANTS ⊆ DESKTOP_GRANTS ⊆ SERVER_GRANTS
```

This belongs to the three built-ins as a triple, not to any single
profile, so it lives outside the conformance suite. Add it to
`packages/test/src/test/task-graph/Entitlements.test.ts` (or a sibling
`EntitlementProfiles.test.ts`) — placement decided in writing-plans.

## Backwards compatibility

- `IEntitlementProfile extends IEntitlementEnforcer`, so anywhere an
  enforcer is consumed, a profile is too.
- `createProfileEnforcer` keeps its single-argument form and widens its
  return type. Callers that passed `(profile, resolver)` migrate to
  `(profile, { resolver })`.
- `ENTITLEMENT_ENFORCER` service token type is unchanged
  (`IEntitlementEnforcer`). Registering a profile under this token
  continues to work; consumers who want the richer profile API can
  register under a new `ENTITLEMENT_PROFILE` token (added in this work)
  or cast.
- `Entitlements.test.ts` is unchanged. The new suite is additive.

## Open questions for writing-plans

1. **Tracking set for `reload` events.** The "previously queried"
   tracking is behavioral but not exposed. Should it persist past
   `dispose`? (Probably no — cleared on dispose.)
2. **Service-token strategy.** Add `ENTITLEMENT_PROFILE` alongside
   `ENTITLEMENT_ENFORCER`, or repurpose? The conservative path is to
   add a new token; existing registrations stay intact.
3. **Documentation update.** `docs/technical/14-entitlements-system.md`
   needs a section on `IEntitlementProfile` and the signal source. The
   plan should include this as a step.
4. **Migration of internal call sites.** Before changing
   `createProfileEnforcer`'s signature, audit and migrate every call
   site that passes a resolver positionally.

## Risks

- **Scope creep into platform sources.** This spec deliberately stops at
  the port. Resist the urge to ship Electron/web/server signal sources
  in the same plan — they belong in their respective consumer packages
  and have their own design questions.
- **Asymmetric event semantics.** `subscribeRevocation`/`subscribeGrant`
  rely on the profile remembering previous verdicts to compute
  flips. The fixtures must drive a deterministic sequence of queries
  before signalling. The conformance suite should not assume the profile
  caches verdicts — only that flips it can detect produce events.
- **Optional entitlements collapsing to "granted" hides the underlying
  reason.** This matches `checkAll` semantics today, but consumers that
  *want* the underlying verdict for diagnostics get nothing. A future
  extension could expose `requestEntitlementVerbose()` returning the
  raw `evaluatePolicy` result. Out of scope here.
