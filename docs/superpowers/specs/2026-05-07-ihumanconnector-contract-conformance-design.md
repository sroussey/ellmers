# IHumanConnector Contract Conformance Suite — Design

**Date:** 2026-05-07
**Status:** Draft (awaiting user review)
**Branch:** `claude/implement-ihumanconnector-vLLA6`

## Summary

Build a parameterized contract conformance suite for `IHumanConnector` in
`@workglow/test`, mirroring the established `runAiProviderConformance` pattern.
Ship a reusable `MockHumanConnector` test backend (scripted response queue)
that allows production tests to drive human-in-the-loop tasks deterministically,
and wire the suite against `MockHumanConnector` (self-conformance) plus the
real `McpElicitationConnector` adapter (paired in-process MCP server/client).

This is contract suite #4 of 5 from the AiProvider design's roadmap. App and
Electron `IHumanConnector` adapters are out of scope — they don't exist in
this repo today and will add their own shims when introduced.

## Motivation

The brief flagged three invariants that no current test asserts:

- Eliciting confirmation returns a typed response within the configured
  timeout.
- Cancellation propagates: an aborted elicitation rejects with an
  AbortError-shaped error within a bounded time.
- Multiple concurrent elicitations don't cross-contaminate (response routed to
  the right caller).

The brief also flagged the open design question: how do you drive a
human-in-the-loop adapter deterministically in tests? Today the only test
coverage is a tiny `NoopConnector` in `packages/test/src/test/human/` that
auto-accepts every request. There is no shared mechanism for production tests
that need to script multi-step human interactions, and no contract suite that
would catch regressions in `McpElicitationConnector` (e.g., dropping the
abort signal, collapsing decline into accept, or silently failing followUp).

A scripted-response `MockHumanConnector` backend solves both problems: it is
the test fixture used by the conformance suite *and* an exported helper that
any production test exercising `HumanInputTask` / `HumanApprovalTask` /
`AiChatTask` can use to drive their human side.

## Goals

- One parameterized `runHumanConnectorConformance(opts)` entrypoint in
  `packages/test/src/contract/human-connector/`.
- An exported, reusable `MockHumanConnector` with a scripted response queue
  (push exact responses, push request-aware response functions, push deferred
  handles for abort and concurrency tests).
- Self-conformance caller for `MockHumanConnector` (proves the mock honors
  every capability it claims, so downstream tests can rely on it).
- Conformance caller for `McpElicitationConnector` using paired in-process
  MCP server + client over `InMemoryTransport`, scripted via the same
  `MockResponseScript` shape.
- Update `packages/test/src/contract/README.md` available-suites table and
  roadmap to mark this contract as shipped.

## Non-goals

- App and Electron adapter shims. Don't exist yet; out of scope.
- `InkHumanConnector` from `examples/cli`. Example code, depends on the Ink
  TTY tree; not a primary adapter.
- A live human-driven UI test. The whole point of the scripted backend is
  determinism in CI.
- Changing the `IHumanConnector` interface itself. The suite measures the
  contract as written in `packages/util/src/human/HumanConnector.ts`.
- Refactoring `HumanInputTask`, `HumanApprovalTask`, or `AiChatTask`. They
  consume the connector and are out of scope, except to confirm they continue
  to pass with the new mock.

## Architecture

### File layout

```
packages/test/src/contract/
  README.md                                     # update available-suites table + roadmap
  human-connector/
    types.ts                                    # opts, handle, fixture, capability matrix
    fixtures.ts                                 # default IHumanRequest fixtures (notify/display/elicit)
    MockHumanConnector.ts                       # exported test backend (scripted response queue)
    runHumanConnectorConformance.ts             # entrypoint
    assertions/
      roundtrip.ts                              # accept / decline / cancel echo
      abort.ts                                  # abort-before-send + abort-mid-elicit
      concurrentIsolation.ts                    # capability-gated
      notifyDisplayFastResolve.ts               # capability-gated per kind
      multiTurnFollowUp.ts                      # capability-gated
      capabilityHonesty.ts                      # followUp absent when claimed false; kinds genuinely unsupported when claimed false

packages/test/src/test/human/
  MockHumanConnector.conformance.test.ts        # self-conformance shim (full capability matrix)
  McpElicitationConnector.conformance.test.ts   # MCP adapter shim
```

### `MockHumanConnector`

Exported from `@workglow/test/contract/human-connector` so production tests
outside the suite can reuse it.

```ts
export type MockResponseEntry =
  | IHumanResponse
  | ((req: IHumanRequest) => IHumanResponse | Promise<IHumanResponse>);

export interface MockResponseScript {
  /** Push an exact response or a request-aware response function. FIFO. */
  push(entry: MockResponseEntry): void;
  /**
   * Push a deferred handle. The next `send()` blocks until `release(response)`
   * is called. Used for abort-mid-elicit and concurrency tests.
   * Releasing after the awaiting `send()` has already rejected is a no-op.
   */
  pushDeferred(): { release(response: IHumanResponse): void };
  /** Inspect what was sent (in order received). */
  readonly received: ReadonlyArray<IHumanRequest>;
  /** Reset between tests (clears queue and received history). */
  clear(): void;
}

export class MockHumanConnector implements IHumanConnector {
  constructor(opts?: {
    /** Default action when no script entry is queued. Defaults to "accept". */
    readonly defaultAction?: HumanResponseAction;
    /** Whether followUp is implemented. Drives capability honesty. Defaults to true. */
    readonly supportsFollowUp?: boolean;
  });
  readonly script: MockResponseScript;
  send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse>;
  /** Present only when supportsFollowUp is true. */
  followUp?: (
    request: IHumanRequest,
    previous: IHumanResponse,
    signal: AbortSignal
  ) => Promise<IHumanResponse>;
}
```

Default behavior with no scripted entry: resolve with
`{ requestId: request.requestId, action: defaultAction, content: undefined, done: true }`,
so unrelated tests that just need *some* connector registered don't have to
script every call. Scripted entries take precedence and consume FIFO.

`MockHumanConnector` honors the `AbortSignal` contract: if a deferred entry
is in flight and the signal aborts, `send()` rejects with an AbortError-shaped
error within `abortGraceMs`.

### Conformance entrypoint

```ts
// packages/test/src/contract/human-connector/types.ts

export type HumanConnectorAssertionId =
  | "roundtrip.accept"
  | "roundtrip.decline"
  | "roundtrip.cancel"
  | "abort.beforeSend"
  | "abort.midElicit"
  | "concurrent.isolation"
  | "notify.fastResolve"
  | "display.fastResolve"
  | "multiTurn.followUp"
  | "capabilityHonesty";

export interface HumanConnectorConformanceOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<HumanConnectorConformanceHandle>;
  readonly capabilities: {
    readonly elicit: boolean;
    readonly notify: boolean;
    readonly display: boolean;
    readonly multiTurn: boolean;
    readonly concurrent: boolean;
    readonly abortMidElicit: boolean;
  };
  readonly fixture?: Partial<ConformanceFixture>;
  /**
   * Assertions known to fail. Marked with `it.fails` (via the same
   * `itExpectFail` helper used by AiProvider conformance) so the
   * suite stays green while the bug is on the fix list.
   */
  readonly expectedFailures?: ReadonlyArray<HumanConnectorAssertionId>;
}

export interface HumanConnectorConformanceHandle {
  readonly connector: IHumanConnector;
  /**
   * Drives the human side. For MockHumanConnector this is the connector's
   * own `script`. For real adapters (e.g. McpElicitationConnector) the
   * factory wires `script.push(...)` to the paired UI's response.
   */
  readonly script: MockResponseScript;
  dispose(): Promise<void>;
}

export interface ConformanceFixture {
  /** Default elicit form schema. */
  readonly elicitContentSchema: DataPortSchema;
  /** Default content data the script returns when accepting an elicit. */
  readonly elicitAcceptContent: Record<string, unknown>;
  /** Default notify request payload. */
  readonly notifyRequest: Pick<IHumanRequest, "message" | "contentSchema" | "contentData">;
  /** Default display request payload. */
  readonly displayRequest: Pick<IHumanRequest, "message" | "contentSchema" | "contentData">;
  /** Bound for abort propagation. Default 1000ms. */
  readonly abortGraceMs: number;
}
```

The `script` handle is the key generalization: every adapter the suite
exercises must provide a way for the test to drive its UI side. For
`MockHumanConnector` it's literally `connector.script`. For
`McpElicitationConnector` the factory builds an in-process MCP client that
intercepts `elicitInput` requests and routes them through a shared
`MockResponseScript`. Adapters that genuinely cannot be scripted cannot join
the suite — capability honesty applies at the contract level.

### Asserted blocks

Each block is a `describe.skipIf` keyed off a capability flag, except for
universal blocks. Each `it` may be replaced with `itExpectFail` (the helper
already used by AiProvider conformance) when the assertion id appears in
`expectedFailures`.

| Block | Capability | What's asserted | Bug class it catches |
|---|---|---|---|
| `roundtrip.accept` | `elicit` | `send` resolves with `{requestId === req.requestId, action: "accept", done: true}`; `content` matches the scripted shape | response misrouting; missing `requestId` echo |
| `roundtrip.decline` | `elicit` | `action === "decline"`, `content === undefined`, no throw | decline collapsed into accept, or thrown as error |
| `roundtrip.cancel` | `elicit` | `action === "cancel"`, `content === undefined`, no throw | cancel collapsed into decline or thrown as error |
| `abort.beforeSend` | always | pre-aborted signal → `send` rejects within `abortGraceMs` with `name === "AbortError"` (or message matches `/abort/i`) | dropped signal in adapter |
| `abort.midElicit` | `abortMidElicit` | scripted `pushDeferred()` then abort → `send` rejects within `abortGraceMs`; releasing the deferred after rejection is a no-op | dropped signal mid-flight |
| `concurrent.isolation` | `concurrent` | two concurrent `send()` with distinct requestIds → each receives the response scripted for *its* requestId | response cross-contamination |
| `notify.fastResolve` | `notify` | `send({kind:"notify"})` resolves with `action: "accept"`, `done: true`, `content: undefined` without consuming any scripted entry | notify silently waits / never resolves |
| `display.fastResolve` | `display` | same shape for `display` | display silently waits / never resolves |
| `multiTurn.followUp` | `multiTurn` | scripted `done:false` then `done:true` → `followUp()` called and returns terminal response; abort during followUp propagates within `abortGraceMs` | followUp drops signal; multi-turn drift |
| `capabilityHonesty` | always | `multiTurn:false` → `connector.followUp === undefined` (not silently no-op); for each kind capability set false, calling `send` with that kind throws or returns `{action:"decline"}` (NOT silently `accept`) | stub-no-op pattern |

`abortGraceMs` mirrors AiProvider conventions: tests assert the rejection
arrives within `abortGraceMs * 4 + 2000` to allow CI jitter, while the spec
target remains `abortGraceMs`.

### Caller shims

`packages/test/src/test/human/MockHumanConnector.conformance.test.ts`:

```ts
import { runHumanConnectorConformance, MockHumanConnector } from
  "../../contract/human-connector/runHumanConnectorConformance";

runHumanConnectorConformance({
  name: "MockHumanConnector",
  timeout: 5_000,
  factory: async () => {
    const connector = new MockHumanConnector({ supportsFollowUp: true });
    return {
      connector,
      script: connector.script,
      dispose: async () => connector.script.clear(),
    };
  },
  capabilities: {
    elicit: true,
    notify: true,
    display: true,
    multiTurn: true,
    concurrent: true,
    abortMidElicit: true,
  },
});
```

A second self-conformance caller registers `MockHumanConnector` with
`supportsFollowUp: false` and `capabilities.multiTurn: false` to prove the
capability-honesty assertion behaves correctly when followUp is genuinely
absent.

`packages/test/src/test/human/McpElicitationConnector.conformance.test.ts`:

```ts
runHumanConnectorConformance({
  name: "McpElicitationConnector",
  timeout: 10_000,
  factory: async () => {
    // Pair an in-process MCP server + client over InMemoryTransport.
    // Wire the client's elicitation handler to consume from a shared
    // MockResponseScript so script.push() drives client responses.
    const { server, client, script, dispose } = await createPairedMcpHarness();
    return {
      connector: new McpElicitationConnector(server),
      script,
      dispose,
    };
  },
  capabilities: {
    elicit: true,
    notify: true,    // McpElicitationConnector handles notify via sendLoggingMessage
    display: true,   // and display via sendLoggingMessage
    multiTurn: true, // followUp is implemented (delegates to send)
    concurrent: true,
    abortMidElicit: true,
  },
  // Populate expectedFailures with whatever surfaces during Phase 3.
});
```

`createPairedMcpHarness` lives next to the shim (or in
`packages/test/src/test/human/mcpHarness.ts` if it grows) and is the only
non-trivial wiring this contract suite introduces. It uses
`@modelcontextprotocol/sdk`'s `InMemoryTransport` (already a dependency of
`@workglow/mcp`) to avoid spawning subprocesses.

## Phasing

### Phase 1 — Foundations

- Create `packages/test/src/contract/human-connector/` skeleton:
  `types.ts`, `fixtures.ts`, `MockHumanConnector.ts`, empty
  `runHumanConnectorConformance.ts`, empty `assertions/` files (one per
  assertion block, exported but with TODO bodies).
- Reuse the existing `itExpectFail` helper from
  `packages/test/src/contract/ai-provider/assertions/itExpectFail.ts`. If it
  is not already path-sharable, lift it to a shared location
  (`packages/test/src/contract/itExpectFail.ts`) and update the AiProvider
  imports — keep the change minimal.
- Update `packages/test/src/contract/README.md` available-suites table to
  add a row for `IHumanConnector`; mark roadmap entry 5 as in progress.

### Phase 2 — Suite + MockHumanConnector

- Implement `MockHumanConnector` with the full `MockResponseScript` API.
- Implement all assertion blocks.
- Add `MockHumanConnector.conformance.test.ts` self-conformance caller (full
  capability matrix). All blocks pass.
- Add the second `MockHumanConnector` caller variant with
  `supportsFollowUp: false` to exercise capability honesty.
- Confirm existing `HumanInputTask` / `HumanApprovalTask` /
  `AiChatTask` tests still pass; no behavioral changes expected.

### Phase 3 — McpElicitationConnector wiring

- Build `createPairedMcpHarness` and the McpElicitationConnector shim.
- Capability flags as listed above.
- Run the suite. Mark any genuinely failing assertions in `expectedFailures`
  with `TODO(phase-4)` comments. Do not skip.
- Suite green.

### Phase 4 — Fix the failures

- For each entry in `expectedFailures` from Phase 3, fix the underlying
  issue in `McpElicitationConnector` (or the surrounding MCP code).
- Flip `expectedFailures` entries off. Suite still green.
- If Phase 3 surfaces no failures, this phase is a no-op and we say so in
  the PR description.

## Success criteria

- Adding a new `IHumanConnector` adapter (App, Electron, future) requires
  writing one shim file (~30 lines) and inherits all conformance assertions.
- The three contract invariants from the brief are continuously asserted in
  CI:
  - Confirmation returns a typed response within the configured timeout
    (`roundtrip.*` + `timeout` opt).
  - Cancellation propagates within bounded time (`abort.*`).
  - Concurrent elicitations don't cross-contaminate (`concurrent.isolation`).
- `MockHumanConnector` is a documented public test helper that downstream
  packages can reuse.
- CI runtime increase ≤ ~5 seconds (suite is fully in-process; no live
  network).

## Open questions

None at this time. Architecture, phasing, capability matrix, and assertion
list confirmed during brainstorming.

## References

- `packages/util/src/human/HumanConnector.ts` — the contract surface.
- `packages/test/src/contract/ai-provider/runAiProviderConformance.ts` —
  exemplary parameterized suite this design mirrors.
- `packages/test/src/contract/README.md` — foundation conventions.
- `packages/mcp/src/tasks/McpElicitationConnector.ts` — the real adapter
  wired in Phase 3.
- `packages/test/src/contract/ai-provider/assertions/itExpectFail.ts` —
  helper for landing the suite with known gaps marked rather than skipped.
- `docs/superpowers/specs/2026-05-04-aiprovider-contract-conformance-design.md`
  — the foundational spec and roadmap source.
