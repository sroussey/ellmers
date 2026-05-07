# IBrowserContext Contract Conformance Suite — Design

**Date:** 2026-05-07
**Status:** Draft (awaiting user review)
**Branch:** `claude/implement-ibrowsercontext-tS1Y8`

## Summary

Build a parameterized contract conformance suite for `IBrowserContext` in
`@workglow/test`, modeled on the existing `runAiProviderConformance` suite.
v1 covers four assertion blocks — capability honesty, tabs lifecycle, ARIA
snapshot ↔ ref round-trip, and network introspection — and ships four
adapter shims (Playwright, BunWebView, Electron, Mock). The final phase
of this project fixes the three IBrowserContext bugs the suite would
detect on day one (empty-array stubs, tabId array-index race, and the
`lastIndexOf(":")` descriptor parser).

## Motivation

The fourth contract conformance suite from the original brief
(`docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`).
Three of the five originally scoped suites have shipped: `AiProvider`
(PR #461), `ITabularStorage` extensions, and `IMigrationRunner`
(PR #464).

`IBrowserContext` has four implementations that drift independently:

- `PlaywrightBackend`
- `ElectronBackend` (extends `CDPBrowserBackend`)
- `BunWebViewBackend` (extends `CDPBrowserBackend`)
- `MockBrowserContext` (test fake)

Three concrete bugs are already known and visible on `main`:

- **Empty-array stubs that defeat feature detection.**
  `PlaywrightBackend.ts:768-774` and `BunWebViewBackend.ts:403-409`
  declare `networkRequests` and `consoleMessages` as concrete arrow
  functions returning `[]`. Feature-detection via
  `typeof ctx.networkRequests === "function"` returns `true`, but the
  method is dead. The `IBrowserContext` interface contract is that
  optional methods are either fully implemented or `undefined`.
- **`tabId` array-index race in Playwright.**
  `PlaywrightBackend.ts:686-736` — `tabs()` returns `tabId: String(idx)`
  derived from `pages.indexOf(...)`. `switchTab`/`closeTab` look up by
  `parseInt(tabId)`. Closing tab `0` shifts every subsequent `tabId`,
  so a stored `tabId` from a prior `tabs()` call now points at the
  wrong page.
- **`lastIndexOf(":")` parser bug in `descriptorToLocator`.**
  `PlaywrightBackend.ts:419-426` — `nth:<inner-descriptor>:<index>`
  uses `lastIndexOf(":")` to split off the trailing index. Any ARIA
  name ending in `:<digits>` (e.g. `"11:30"` with `nth:5` produces
  `nth:getByRole:textbox:11:30:5`) is mis-parsed as
  `inner=getByRole:textbox:11:30, index=5`. Disambiguation impossible
  without escaping or length-prefixing.

Each bug is one assertion. Without a contract suite, the same class of
bug recurs as new backends are added.

## Goals

- One parameterized `runIBrowserContextConformance(opts)` entrypoint
  under `packages/test/src/contract/browser-context/`.
- Suite runs against four adapters: Playwright (live, gated on
  `RUN_PLAYWRIGHT_TESTS`), BunWebView (live, gated on
  `RUN_BUNWEBVIEW_TESTS`), Electron (live, gated on
  `RUN_ELECTRON_TESTS` — currently no CI runner; runs locally), and
  `MockBrowserContext` (in-memory, always runs).
- Four assertion blocks: capability honesty (negative + positive),
  tabs lifecycle, ARIA round-trip, network introspection.
- Three known bugs fixed within this project's final phase.
- One row added to `packages/test/src/contract/README.md`'s "Available
  suites" table.

## Non-goals

- HTTP-server-based fixture infrastructure. The fixture is a
  self-contained `data:` URL.
- A bare `CDPBrowserBackend` shim. The class is abstract — Electron
  and BunWebView are the concrete CDP-derived backends. Both are
  already in the four-shim list.
- Migrating `packages/test/src/test/browser/genericBrowserTaskTests.ts`
  into the contract pattern. That suite asserts the `BrowserXxxTask`
  layer (one level higher than `IBrowserContext`); the two are
  orthogonal.
- An Electron CI runner. The Electron shim lives in the repo so the
  contract is pinned, but it is skipped without `RUN_ELECTRON_TESTS`.
- New env vars beyond `RUN_*_TESTS` (which already exist).

## Architecture

### File layout

```
packages/test/src/contract/browser-context/
  runIBrowserContextConformance.ts     # entrypoint
  types.ts                             # opts + capability matrix + handle
  fixtures.ts                          # FIXTURE_PAGE_URL + ARIA edge-case names
  assertions/
    capabilityHonesty.ts               # B+ enforcement for optional methods
    tabsLifecycle.ts                   # open/close/switch + concurrent-close stability
    ariaRoundTrip.ts                   # snapshot → ref → click round-trip, edge names
    networkIntrospection.ts            # fixture issues fetch → networkRequests sees it
    itExpectFail.ts                    # copy from contract/ai-provider/

packages/test/src/test/browser/
  Playwright_Generic.integration.test.ts   # NEW shim
  BunWebView_Generic.integration.test.ts   # NEW shim
  Electron_Generic.integration.test.ts     # NEW shim, skip:!process.env.RUN_ELECTRON_TESTS
  MockBrowser_Generic.test.ts              # NEW shim (no skip)
  # existing files stay: BrowserSessionRegistry.test.ts, MockBrowser.test.ts,
  # PlaywrightBrowser.integration.test.ts, BunWebViewBrowser.integration.test.ts,
  # genericBrowserTaskTests.ts (Tasks-level coverage; orthogonal)
```

The contract suite asserts `IBrowserContext` directly. The existing
`genericBrowserTaskTests.ts` continues to assert the `BrowserXxxTask`
layer. They overlap conceptually but exercise different surfaces and
are not merged in v1.

### `runIBrowserContextConformance` API

```ts
export interface IBrowserContextConformanceOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<BrowserContextHandle>;
  readonly capabilities: BrowserContextCapabilities;
  readonly fixture?: Partial<BrowserContextFixture>;
  /**
   * Names of assertions currently broken in this adapter; each is wrapped
   * in `it.fails` instead of `it`. Remove the entry once the bug is fixed.
   *
   * Known names:
   *   "tabs.concurrentCloseStable"
   *   "aria.colonInName"
   *   "capability.networkRequests.undefinedWhenFalse"
   *   "capability.consoleMessages.undefinedWhenFalse"
   */
  readonly expectedFailures?: ReadonlyArray<string>;
}

export interface BrowserContextHandle {
  /** Construct and connect a fresh context. Called per top-level block. */
  readonly create: () => Promise<IBrowserContext>;
  /** Disconnect and release resources for a context returned by create(). */
  readonly dispose: (ctx: IBrowserContext) => Promise<void>;
}

export interface BrowserContextCapabilities {
  /** false for single-view backends (e.g. BunWebView). */
  readonly multipleTabs: boolean;
  /** Optional method honesty + positive test. */
  readonly networkRequests: boolean;
  /** Optional method honesty + positive test. */
  readonly consoleMessages: boolean;
  /** Every backend should be true; flag exists for hygiene/symmetry. */
  readonly ariaSnapshot: boolean;
}

export interface BrowserContextFixture {
  readonly pageUrl: string;
  readonly networkMarkerUrl: string;     // url substring expected in networkRequests()
  readonly consoleMarker: string;        // text expected in consoleMessages()
  readonly ariaEdgeCaseNames: ReadonlyArray<string>;
}
```

Differences from `runAiProviderConformance`:

- **`create` per test, not `register` once.** Browser contexts are
  heavyweight but stateful (open tabs, navigation history). Each
  top-level assertion block creates a fresh context in `beforeAll`,
  disposes in `afterAll`, so block N's tab churn cannot affect block
  N+1's ARIA test.
- **No `inspect()`.** v1 doesn't need whitebox state. If a future
  assertion (e.g. tabId stability via internal map inspection) needs
  it, add it then.
- **No `models` map.** N/A for browser contexts.

### Capability honesty (the new convention)

The interface contract is: optional methods (`networkRequests`,
`consoleMessages`) are either fully implemented or `undefined`. The
suite enforces this in both directions:

- *Negative branch:* if `capabilities.networkRequests === false`, the
  assertion `typeof ctx.networkRequests === "undefined"` must hold.
  This catches the `[].`-returning stub pattern.
- *Positive branch:* if `capabilities.networkRequests === true`, the
  context must navigate to `fixture.pageUrl`, wait for idle, and
  `networkRequests()` must return ≥1 entry whose `url` includes
  `fixture.networkMarkerUrl`. Same for `consoleMessages` /
  `fixture.consoleMarker`.

This is the "B+" enforcement strategy: the capability flag is the
single source of truth, and *both* directions are tested.

### Asserted blocks

| Block | Capability gate | What's asserted | Bug it catches |
|---|---|---|---|
| Capability honesty (negative) | always | For every false flag, the corresponding optional method is strictly `undefined` (not a function). | `PlaywrightBackend.ts:768-774`, `BunWebViewBackend.ts:403-409` empty-array stubs |
| Capability honesty (positive) | per-flag (true) | Navigate to fixture → wait for idle → `networkRequests()` returns ≥1 entry whose url contains the fixture marker. Same for `consoleMessages`. | A stub wired to `capabilities=true` but returning `[]` |
| Tabs — basic lifecycle | always | After connect, `tabs().length ≥ 1`. `newTab(fixtureUrl)` increases length by 1 (or stays at 1 if `!multipleTabs`). `closeTab(id)` decreases length (or disconnects, single-view variant). | Smoke; protects future refactors |
| Tabs — tabId stability under concurrent close | `multipleTabs` | Open 4 tabs A/B/C/D → capture all four `tabId`s → `Promise.all([closeTab(A.tabId), closeTab(B.tabId)])` → for each remaining (C, D), `switchTab(originalTabId)` lands on the same `url` it had before. | `PlaywrightBackend.ts:686-736` array-index race |
| ARIA — snapshot ↔ ref round-trip | `ariaSnapshot` | Snapshot fixture page; for each fixture node (covering edge-case names: `"foo:bar"`, `"11:30"`, `"a"`, `""`, 200-char, unicode `"héllo→"`), `clickByRole(role, name)` lands on that node, verified by side-effect (each button sets `data-clicked="<idx>"` on `#sentinel`). | `PlaywrightBackend.ts:419-426` `lastIndexOf(":")` parser |
| ARIA — ref reuse | `ariaSnapshot` | A ref captured from a snapshot remains usable for `click`/`textContent` after another `snapshot()` call (no implicit invalidation). | Regression guard for ref-map churn |

The fixture page (data: URL) embeds:

- A `<button>` per ARIA edge-case name, each with an `onclick` setting
  `data-clicked="<idx>"` on `#sentinel`.
- A `<script>` that fires `fetch("data:text/plain,fixture-network-marker")`
  on load.
- `console.log("fixture-console-marker")` on load.
- A `<div id="sentinel">` for click verification.

### Adapter shims

Shape mirrors `Anthropic_Generic.integration.test.ts`. Each shim is
~25 lines.

```ts
// Playwright_Generic.integration.test.ts
runIBrowserContextConformance({
  name: "Playwright",
  skip: !process.env.RUN_PLAYWRIGHT_TESTS,
  timeout: 60_000,
  factory: async () => {
    const { PlaywrightBackend } = await import("@workglow/browser-control/task");
    return {
      create: async () => {
        const ctx = new PlaywrightBackend();
        await ctx.connect({ headless: true });
        return ctx;
      },
      dispose: (ctx) => ctx.disconnect(),
    };
  },
  capabilities: {
    multipleTabs: true,
    networkRequests: false,    // currently a stub; flips after Phase 4
    consoleMessages: false,    // currently a stub; flips after Phase 4
    ariaSnapshot: true,
  },
  expectedFailures: [
    "tabs.concurrentCloseStable",                    // array-index race
    "aria.colonInName",                              // lastIndexOf parser
    "capability.networkRequests.undefinedWhenFalse", // stub field exists
    "capability.consoleMessages.undefinedWhenFalse",
  ],
});
```

| Adapter | multipleTabs | networkRequests | consoleMessages | ariaSnapshot | Notes |
|---|---|---|---|---|---|
| Playwright | true | false | false | true | All three known bugs in expectedFailures until Phase 4 |
| BunWebView | false | false | false | true | Single-view; `multipleTabs: false` skips the tabId-stability block; capability-honesty failures in expectedFailures until Phase 4 |
| Electron | true | false | false | true | Skipped without `RUN_ELECTRON_TESTS` |
| Mock | true | false | false | true | Reference impl; zero expectedFailures (see Phase 2 note on stub removal) |

`MockBrowserContext` is the reference implementation. If it cannot
satisfy the suite, the suite is wrong, not the mock. This is why it
has zero `expectedFailures`.

## Phasing

One branch (`claude/implement-ibrowsercontext-tS1Y8`), one or more PRs.

### Phase 1 — Foundations & fixtures

- Add `packages/test/src/contract/browser-context/` with `types.ts`,
  `fixtures.ts`, `runIBrowserContextConformance.ts` (entrypoint
  shell), `assertions/itExpectFail.ts` (copied from
  `contract/ai-provider/`).
- Build `FIXTURE_PAGE_URL` data: URL with edge-case ARIA names,
  on-load fetch marker, console marker, click sentinel.
- Add a row to `packages/test/src/contract/README.md`'s "Available
  suites" table.
- No assertions wired yet; no callers.

### Phase 2 — Suite + Mock + first real adapter

- Implement all four assertion blocks (`capabilityHonesty`,
  `tabsLifecycle`, `ariaRoundTrip`, `networkIntrospection`).
- Wire `MockBrowser_Generic.test.ts` (must pass clean — Mock is the
  reference).
- Wire `Playwright_Generic.integration.test.ts` with the listed
  `expectedFailures` for the three known bugs.
- Extend `MockBrowserContext` if needed to satisfy the fixture page's
  click sentinel and ARIA edge-case names, **and** remove any
  empty-stub `networkRequests` / `consoleMessages` properties so the
  capability-honesty negative branch passes. If extending the mock
  proves disproportionate, drop the Mock shim from v1; the suite is
  still valuable with three shims.
- CI green: Mock shim passes; Playwright shim passes (failures
  captured in `it.fails`).

### Phase 3 — Remaining shims

- Wire `BunWebView_Generic.integration.test.ts` with appropriate
  `expectedFailures` (single-view, network/console stubs).
- Wire `Electron_Generic.integration.test.ts` (skipped in CI without
  `RUN_ELECTRON_TESTS`; runs locally).
- Confirm CI cost on the `RUN_PLAYWRIGHT_TESTS` job is within budget
  (target ≤30 s, mirroring AiProvider).

### Phase 4 — Fix the three known bugs

For each fix, drop the corresponding `expectedFailures` entry and
verify the suite turns green.

1. **Empty-array stubs** (`PlaywrightBackend.ts:768-774`,
   `BunWebViewBackend.ts:403-409`).
   - v1 fix: delete the properties so the optional method becomes
     `undefined` (declares "not supported"; satisfies B+ negative).
     Drops `capability.networkRequests.undefinedWhenFalse` and
     `capability.consoleMessages.undefinedWhenFalse` from
     `expectedFailures`.
   - Real implementations (Playwright `page.on("request")`, etc.) are
     a follow-up: when those land, capability flags flip to `true` in
     the shim and the positive branch becomes asserted.

2. **Tabs `tabId` array-index race**
   (`PlaywrightBackend.ts:686-736`).
   - Replace array-index ids with a `WeakMap<Page, string>` (or
     equivalent counter Map) seeded on `newPage` and
     `context.on("page")`. Generated id (e.g. `"t1"`, `"t2"`) is
     stable across closes and concurrent operations. Drops
     `tabs.concurrentCloseStable` from `expectedFailures`.

3. **`descriptorToLocator` `lastIndexOf(":")` parser**
   (`PlaywrightBackend.ts:419-426`).
   - Replace ad-hoc string descriptors with structured records: store
     `{kind: "role", role, name} | {kind: "text", text} | {kind: "css", selector} | {kind: "nth", inner: Descriptor, index}`
     in `_refMap`. Eliminates string parsing entirely. Smaller diff
     than escaping. Localized to `PlaywrightBackend` and a few private
     helpers. Drops `aria.colonInName` from `expectedFailures`.

Each fix lands in its own commit so reverts are granular. Any
additional failures discovered during Phase 2 are added to this
phase's fix list rather than deferred.

## Success criteria

- Adding a fifth backend (e.g., a future Tauri or WebDriver-BiDi
  adapter) requires writing one shim file (~25 lines) and inherits
  all four assertion blocks.
- The three named IBrowserContext bugs are fixed and continuously
  asserted in CI.
- An adapter cannot regress capability honesty, tabId stability, or
  ARIA round-trip without a CI failure.
- CI runtime increase ≤ ~30 s on the `RUN_PLAYWRIGHT_TESTS` job,
  measured Phase 2 → 3.
- The conventions in `packages/test/src/contract/README.md` extend
  cleanly: the IBrowserContext entry validates that the foundations
  doc generalizes beyond AiProvider. The README is updated to
  document the `create`/`dispose`-per-test factory shape as a
  legitimate variant of `register`/`dispose`/`inspect`.

## Risks & mitigations

- **`data:` URL restrictions in Electron.** Some Electron
  configurations block `data:` navigation or forbid sub-fetches from
  data: URLs. *Mitigation:* `BrowserContextFixture` is overridable, so
  the Electron shim can point at a same-origin URL served by an
  in-process http server if needed. Decided in Phase 3 once observed.
- **Mock backend cannot satisfy ARIA edge cases.** If extending
  `MockBrowserContext` to handle 200-char names, empty names, and a
  click sentinel proves disproportionate, drop the Mock shim from v1.
- **Concurrent-close test is timing-sensitive on Playwright.**
  *Mitigation:* schedule both closes synchronously via `Promise.all`
  before either resolves; the assertion is on stored ids, not on
  close ordering.
- **BunWebView ARIA fidelity.** BunWebView's accessibility tree may
  not include all elements Playwright does. *Mitigation:* the
  `ariaSnapshot: true` flag is asserted, but if BunWebView misses
  some edge-case names, narrow the BunWebView fixture override
  accordingly.
- **Foundations drift.** The IBrowserContext shape (`create`/`dispose`
  per test, no `inspect`, no `models`) deviates from the AiProvider
  `register`/`dispose`/`inspect` shape. *Mitigation:* update
  `packages/test/src/contract/README.md` to document both factory
  shapes as legitimate variants — the principle is "fresh handle per
  test", and the methods on it are contract-specific.

## Roadmap — remaining contract suites

After this project ships, the original brief leaves two suites:

1. **`EntitlementProfile`** — desktop / web / server profiles enforce
   identical contracts.
2. **`IHumanConnector`** — App + Electron elicitation backends.

Worker-proxy is also still on the original list; whether it warrants
its own contract suite or rolls into AiProvider/Storage is an open
question for a future brainstorm.

## Open questions

None at this time. Scope, capability-honesty enforcement, adapter
list, fixture strategy, and phasing were confirmed during
brainstorming.

## References

- `docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`
  — original brief identifying the IBrowserContext invariants.
- `packages/test/src/contract/ai-provider/` — reference implementation
  of the parameterized contract suite pattern.
- `packages/test/src/contract/README.md` — foundations doc updated by
  Phase 1.
- `packages/browser-control/src/task/IBrowserContext.ts` — interface
  under test.
- `packages/browser-control/src/task/PlaywrightBackend.ts:419-426,686-736,768-774`
  — known bugs to fix in Phase 4.
- `packages/browser-control/src/task/BunWebViewBackend.ts:403-409` —
  known bug to fix in Phase 4.
- `packages/test/src/test/browser/genericBrowserTaskTests.ts` — Tasks-
  level suite that stays in place; orthogonal to this contract suite.
- `packages/test/src/test/browser/MockBrowserContext.ts` — reference
  implementation used by the Mock shim.
