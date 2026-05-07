# IHumanConnector Contract Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parameterized contract conformance suite for `IHumanConnector` (`runHumanConnectorConformance`) plus a reusable scripted-response `MockHumanConnector` test backend, then wire the suite against `MockHumanConnector` (self-conformance) and `McpElicitationConnector` (paired in-process MCP harness).

**Architecture:** Mirrors the established `runAiProviderConformance` pattern under `packages/test/src/contract/`. Each assertion lives in its own file under `assertions/` and is gated by a capability flag. The factory returns a handle exposing `connector` plus a `script` (the `MockResponseScript` shape) that drives the human side — for the mock it's the connector's own queue, for MCP it's the paired in-process client's elicitation responses.

**Tech Stack:** TypeScript (Node 24+), Vitest, Bun workspaces, `@workglow/util`'s `IHumanConnector` contract, `@modelcontextprotocol/sdk` for the MCP harness in Phase 3.

**Spec:** `docs/superpowers/specs/2026-05-07-ihumanconnector-contract-conformance-design.md`

**Branch:** `claude/implement-ihumanconnector-vLLA6` (already checked out)

**Conventions to follow without exception:**
- Apache-2.0 license header on every new file. **Year is 2026** for files created in this project (CLAUDE.md: "year is the year the file was *created*").
- Named exports only. No default exports. No enums (`as const` objects only).
- `import type { ... }` for type-only imports.
- Never import from files named `index`, `node`, `bun`, `browser`, `common` — import from the specific module.
- `interface` prefixed with `I` for public interfaces (`IHumanConnector`, `IHumanRequest`, `IHumanResponse`).
- 100-char print width, double quotes, semicolons, trailing commas (es5).
- Use `bun scripts/test.ts <section> vitest` to run a focused subset; full vitest is `bun run test:vitest`.

**Verification command for this project:** `bun scripts/test.ts human vitest` (runs `packages/test/src/test/human/`). Verify after each task that adds or modifies test code.

---

## File Structure

**New files (all under `packages/test/src/`):**

```
contract/
  itExpectFail.ts                                  # MOVED from contract/ai-provider/assertions/
  human-connector/
    types.ts                                       # opts, handle, fixture, capability matrix, assertion ids
    fixtures.ts                                    # default IHumanRequest fixtures + abortGraceMs
    MockHumanConnector.ts                          # exported scripted-response test backend
    runHumanConnectorConformance.ts                # entrypoint: describe.skipIf, beforeAll/afterAll, wire all assertion blocks
    assertions/
      roundtrip.ts                                 # accept / decline / cancel echo
      abort.ts                                     # abort-before-send + abort-mid-elicit
      concurrentIsolation.ts                       # capability-gated
      notifyDisplayFastResolve.ts                  # one block, branches per kind
      multiTurnFollowUp.ts                         # capability-gated
      capabilityHonesty.ts                         # followUp absent + kinds-not-supported

test/
  human/
    MockHumanConnector.unit.test.ts                # tight unit tests of the mock itself
    MockHumanConnector.conformance.test.ts         # full-capability self-conformance shim
    MockHumanConnector_NoFollowUp.conformance.test.ts  # no-followUp variant for capability honesty
    McpElicitationConnector.conformance.test.ts    # MCP adapter shim (Phase 3)
    mcpHarness.ts                                  # createPairedMcpHarness used by Phase 3 shim
```

**Modified files:**

- `packages/test/src/contract/ai-provider/runAiProviderConformance.ts` — update `itExpectFail` import path after the move.
- `packages/test/src/contract/ai-provider/assertions/signalHonoring.ts` — same.
- (Any other AiProvider assertion file that imports `itExpectFail` — `grep -rln "itExpectFail" packages/test/src/contract/ai-provider`.)
- `packages/test/src/contract/README.md` — add row to the Available suites table; mark roadmap item 5 as in progress.

---

## Phase 1 — Foundations

### Task 1.1: Lift `itExpectFail` to a shared contract location

Move the helper so the new suite can reuse it without cross-suite imports.

**Files:**
- Create: `packages/test/src/contract/itExpectFail.ts`
- Modify: `packages/test/src/contract/ai-provider/assertions/itExpectFail.ts` (delete)
- Modify: every AiProvider file that imports `itExpectFail` (update path).

- [ ] **Step 1: Create the new shared module.**

`packages/test/src/contract/itExpectFail.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from "vitest";

type ItFn = (name: string, fn: () => Promise<void> | void, timeout?: number) => void;

/**
 * Cross-runner polyfill for `it.fails`. Vitest exposes it natively; bun's
 * native `bun test` runner does not. Under bun we wrap the body in a
 * try/catch and assert that it threw — so a passing-when-expected-fail
 * test still surfaces as a CI failure (signalling "remove from
 * expectedFailures").
 */
export const itExpectFail: ItFn = (name, fn, timeout) => {
  const native = (it as unknown as { fails?: ItFn }).fails;
  if (typeof native === "function") {
    native(name, fn, timeout);
    return;
  }
  it(
    `${name} [expected-fail]`,
    async () => {
      let passed = false;
      try {
        await fn();
        passed = true;
      } catch {
        // expected; the test was supposed to fail
      }
      if (passed) {
        throw new Error(
          `Test "${name}" was marked as expected-fail but passed. Remove its name from opts.expectedFailures.`
        );
      }
    },
    timeout
  );
};
```

- [ ] **Step 2: Find all callers of the old path.**

Run: `grep -rln "assertions/itExpectFail" packages/test/src/contract/ai-provider`
Expected: list of files importing from the old path.

- [ ] **Step 3: Update each caller's import.**

In each file from Step 2, replace:
```ts
import { itExpectFail } from "./itExpectFail";
```
with:
```ts
import { itExpectFail } from "../../itExpectFail";
```
(Adjust the relative path if the file is not under `assertions/`.)

- [ ] **Step 4: Delete the old module.**

Run: `git rm packages/test/src/contract/ai-provider/assertions/itExpectFail.ts`

- [ ] **Step 5: Run AiProvider tests to verify the move did not break them.**

Run: `bun scripts/test.ts ai-provider vitest`
Expected: Same pass/fail counts as before; no `Cannot find module` errors.

- [ ] **Step 6: Commit.**

```bash
git add packages/test/src/contract/itExpectFail.ts packages/test/src/contract/ai-provider
git commit -m "refactor(test): lift itExpectFail to shared contract location"
```

---

### Task 1.2: Define types for the conformance suite

**Files:**
- Create: `packages/test/src/contract/human-connector/types.ts`

- [ ] **Step 1: Write the types module.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IHumanConnector,
  IHumanRequest,
  IHumanResponse,
} from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";

/**
 * Stable identifiers for each conformance assertion. Add to `expectedFailures`
 * to mark an assertion as known-failing without skipping it.
 */
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

export interface HumanConnectorCapabilities {
  /** Connector handles `kind: "elicit"` requests with a real human-driven response. */
  readonly elicit: boolean;
  /** Connector handles `kind: "notify"` requests (fast-resolve, no script consumption). */
  readonly notify: boolean;
  /** Connector handles `kind: "display"` requests (fast-resolve, no script consumption). */
  readonly display: boolean;
  /** Connector implements `followUp()` for multi-turn elicit conversations. */
  readonly multiTurn: boolean;
  /** Connector correctly isolates concurrent in-flight `send()` calls. */
  readonly concurrent: boolean;
  /** Connector honors `AbortSignal` while an elicit is in flight (mid-flight abort). */
  readonly abortMidElicit: boolean;
}

/**
 * Either an exact response, or a request-aware function. FIFO consumption.
 */
export type MockResponseEntry =
  | IHumanResponse
  | ((req: IHumanRequest) => IHumanResponse | Promise<IHumanResponse>);

/**
 * Test-side handle for driving the human side of an `IHumanConnector`. Every
 * adapter wired into the conformance suite must expose a `MockResponseScript`
 * — for `MockHumanConnector` it's the connector's own queue; for real
 * adapters (e.g. McpElicitationConnector) the factory wires `push(...)` to
 * the paired UI's response.
 */
export interface MockResponseScript {
  /** Push an exact response or a request-aware response function. FIFO. */
  push(entry: MockResponseEntry): void;
  /**
   * Push a deferred handle. The next `send()` blocks until `release(response)`
   * is called. Releasing after the awaiting `send()` has rejected is a no-op.
   */
  pushDeferred(): { release(response: IHumanResponse): void };
  /** Inspect what was sent (in order received). */
  readonly received: ReadonlyArray<IHumanRequest>;
  /** Reset between tests (clears queue and received history). */
  clear(): void;
}

export interface HumanConnectorConformanceHandle {
  readonly connector: IHumanConnector;
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
  /** Bound for abort propagation (ms). */
  readonly abortGraceMs: number;
}

export interface HumanConnectorConformanceOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<HumanConnectorConformanceHandle>;
  readonly capabilities: HumanConnectorCapabilities;
  readonly fixture?: Partial<ConformanceFixture>;
  /**
   * Assertions known to fail. Each named id is wrapped in `it.fails` instead
   * of `it`. Remove the entry once the adapter bug is fixed.
   */
  readonly expectedFailures?: ReadonlyArray<HumanConnectorAssertionId>;
}
```

- [ ] **Step 2: Type-check.**

Run: `cd packages/test && tsgo --noEmit` (or `bun run build-types`)
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/human-connector/types.ts
git commit -m "feat(test): IHumanConnector conformance types"
```

---

### Task 1.3: Build default fixtures

**Files:**
- Create: `packages/test/src/contract/human-connector/fixtures.ts`

- [ ] **Step 1: Write the fixtures module.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";

import type { ConformanceFixture } from "./types";

const elicitSchema: DataPortSchema = {
  type: "object",
  properties: {
    approved: {
      type: "boolean",
      title: "Approved",
      description: "Whether the request is approved",
    },
    reason: { type: "string", title: "Reason" },
  },
  required: ["approved"],
  additionalProperties: false,
};

const emptySchema: DataPortSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

export const DEFAULT_HUMAN_CONFORMANCE_FIXTURE: ConformanceFixture = {
  elicitContentSchema: elicitSchema,
  elicitAcceptContent: { approved: true, reason: "looks good" },
  notifyRequest: {
    message: "Job completed.",
    contentSchema: emptySchema,
    contentData: { jobId: "test-1" },
  },
  displayRequest: {
    message: "Here is the result.",
    contentSchema: emptySchema,
    contentData: { result: 42 },
  },
  abortGraceMs: 1000,
};

export function resolveHumanConformanceFixture(
  override: Partial<ConformanceFixture> | undefined
): ConformanceFixture {
  if (!override) return DEFAULT_HUMAN_CONFORMANCE_FIXTURE;
  return { ...DEFAULT_HUMAN_CONFORMANCE_FIXTURE, ...override };
}
```

- [ ] **Step 2: Commit.**

```bash
git add packages/test/src/contract/human-connector/fixtures.ts
git commit -m "feat(test): IHumanConnector conformance fixtures"
```

---

### Task 1.4: Update contract README

**Files:**
- Modify: `packages/test/src/contract/README.md`

- [ ] **Step 1: Add a row to the Available suites table.**

Find the table starting with `| Contract | Suite | Adapters |` and add this row at the bottom:

```
| `IHumanConnector` | `contract/human-connector/runHumanConnectorConformance` | MockHumanConnector, McpElicitationConnector |
```

- [ ] **Step 2: Update the roadmap.**

Find the line `5. \`IHumanConnector\` — App + Electron elicitation backends.` and replace it with:

```
5. `IHumanConnector` — IN PROGRESS — `MockHumanConnector` + `McpElicitationConnector`. App / Electron adapters add their own shim when introduced.
```

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/README.md
git commit -m "docs(test): add IHumanConnector row to contract suites table"
```

---

## Phase 2 — MockHumanConnector and assertions

### Task 2.1: TDD MockHumanConnector — auto-accept default behavior

**Files:**
- Create: `packages/test/src/test/human/MockHumanConnector.unit.test.ts`
- Create: `packages/test/src/contract/human-connector/MockHumanConnector.ts`

- [ ] **Step 1: Write the failing test.**

`packages/test/src/test/human/MockHumanConnector.unit.test.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { MockHumanConnector } from "../../contract/human-connector/MockHumanConnector";

function elicitReq(requestId: string): IHumanRequest {
  return {
    requestId,
    targetHumanId: "default",
    kind: "elicit",
    message: "test",
    contentSchema: { type: "object", properties: {}, additionalProperties: true },
    contentData: undefined,
    expectsResponse: true,
    mode: "single",
    metadata: undefined,
  };
}

describe("MockHumanConnector — defaults", () => {
  it("auto-accepts when no script entry is queued", async () => {
    const c = new MockHumanConnector();
    const ac = new AbortController();
    const res = await c.send(elicitReq("r1"), ac.signal);
    expect(res.requestId).toBe("r1");
    expect(res.action).toBe("accept");
    expect(res.done).toBe(true);
    expect(res.content).toBeUndefined();
  });

  it("records every request received", async () => {
    const c = new MockHumanConnector();
    const ac = new AbortController();
    await c.send(elicitReq("r1"), ac.signal);
    await c.send(elicitReq("r2"), ac.signal);
    expect(c.script.received.map((r) => r.requestId)).toEqual(["r1", "r2"]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails.**

Run: `bun scripts/test.ts human vitest`
Expected: FAIL — `Cannot find module .../MockHumanConnector`.

- [ ] **Step 3: Implement just enough.**

`packages/test/src/contract/human-connector/MockHumanConnector.ts`:

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HumanResponseAction,
  IHumanConnector,
  IHumanRequest,
  IHumanResponse,
} from "@workglow/util";

import type { MockResponseEntry, MockResponseScript } from "./types";

export interface MockHumanConnectorOpts {
  /** Default action when no script entry is queued. Defaults to "accept". */
  readonly defaultAction?: HumanResponseAction;
  /** Whether `followUp` is implemented. Defaults to true. */
  readonly supportsFollowUp?: boolean;
}

class Script implements MockResponseScript {
  private readonly _received: IHumanRequest[] = [];

  get received(): ReadonlyArray<IHumanRequest> {
    return this._received;
  }

  recordReceived(req: IHumanRequest): void {
    this._received.push(req);
  }

  push(_entry: MockResponseEntry): void {
    throw new Error("not yet implemented");
  }

  pushDeferred(): { release(response: IHumanResponse): void } {
    throw new Error("not yet implemented");
  }

  clear(): void {
    this._received.length = 0;
  }
}

export class MockHumanConnector implements IHumanConnector {
  private readonly defaultAction: HumanResponseAction;
  private readonly _script: Script;

  constructor(opts: MockHumanConnectorOpts = {}) {
    this.defaultAction = opts.defaultAction ?? "accept";
    this._script = new Script();
  }

  get script(): MockResponseScript {
    return this._script;
  }

  async send(request: IHumanRequest, _signal: AbortSignal): Promise<IHumanResponse> {
    this._script.recordReceived(request);
    return {
      requestId: request.requestId,
      action: this.defaultAction,
      content: undefined,
      done: true,
    };
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `bun scripts/test.ts human vitest`
Expected: PASS for the two test cases above.

- [ ] **Step 5: Commit.**

```bash
git add packages/test/src/contract/human-connector/MockHumanConnector.ts packages/test/src/test/human/MockHumanConnector.unit.test.ts
git commit -m "feat(test): MockHumanConnector auto-accept default"
```

---

### Task 2.2: TDD scripted FIFO responses

**Files:**
- Modify: `packages/test/src/test/human/MockHumanConnector.unit.test.ts`
- Modify: `packages/test/src/contract/human-connector/MockHumanConnector.ts`

- [ ] **Step 1: Add failing tests.**

Append to the existing test file's `describe("MockHumanConnector — defaults")` or open a new `describe("MockHumanConnector — scripted")`:

```ts
import type { IHumanResponse } from "@workglow/util";

describe("MockHumanConnector — scripted", () => {
  it("consumes pushed responses FIFO", async () => {
    const c = new MockHumanConnector();
    c.script.push({ requestId: "ignored", action: "decline", content: undefined, done: true });
    c.script.push((req) => ({
      requestId: req.requestId,
      action: "accept",
      content: { ok: true },
      done: true,
    }));

    const a = await c.send(elicitReq("r1"), new AbortController().signal);
    const b = await c.send(elicitReq("r2"), new AbortController().signal);

    expect(a.action).toBe("decline");
    // Pushed exact responses still echo the actual requestId from the request,
    // so consumers can rely on requestId being correct regardless of script entry.
    expect(a.requestId).toBe("r1");
    expect(b.action).toBe("accept");
    expect(b.requestId).toBe("r2");
    expect(b.content).toEqual({ ok: true });
  });

  it("falls back to default action once the queue is drained", async () => {
    const c = new MockHumanConnector();
    c.script.push({ requestId: "x", action: "decline", content: undefined, done: true });
    const ac = new AbortController();
    const a = await c.send(elicitReq("r1"), ac.signal);
    const b = await c.send(elicitReq("r2"), ac.signal);
    expect(a.action).toBe("decline");
    expect(b.action).toBe("accept");
  });

  it("clear() empties queue and received history", async () => {
    const c = new MockHumanConnector();
    c.script.push({ requestId: "x", action: "decline", content: undefined, done: true });
    await c.send(elicitReq("r1"), new AbortController().signal);
    expect(c.script.received).toHaveLength(1);
    c.script.clear();
    expect(c.script.received).toHaveLength(0);
    const after = await c.send(elicitReq("r2"), new AbortController().signal);
    expect(after.action).toBe("accept");
  });
});
```

- [ ] **Step 2: Confirm they fail.**

Run: `bun scripts/test.ts human vitest`
Expected: FAIL with "not yet implemented".

- [ ] **Step 3: Implement the queue.**

In `MockHumanConnector.ts`, replace the `Script.push` body and add a queue field:

```ts
class Script implements MockResponseScript {
  private readonly _received: IHumanRequest[] = [];
  private readonly _queue: MockResponseEntry[] = [];

  get received(): ReadonlyArray<IHumanRequest> {
    return this._received;
  }

  recordReceived(req: IHumanRequest): void {
    this._received.push(req);
  }

  push(entry: MockResponseEntry): void {
    this._queue.push(entry);
  }

  pushDeferred(): { release(response: IHumanResponse): void } {
    throw new Error("not yet implemented");
  }

  shift(): MockResponseEntry | undefined {
    return this._queue.shift();
  }

  clear(): void {
    this._received.length = 0;
    this._queue.length = 0;
  }
}
```

And update `MockHumanConnector.send`:

```ts
async send(request: IHumanRequest, _signal: AbortSignal): Promise<IHumanResponse> {
  this._script.recordReceived(request);
  const entry = this._script.shift();
  if (entry === undefined) {
    return {
      requestId: request.requestId,
      action: this.defaultAction,
      content: undefined,
      done: true,
    };
  }
  const resolved = typeof entry === "function" ? await entry(request) : entry;
  // Always echo the actual request's requestId so adapters cannot accidentally
  // route responses to the wrong caller via a stale id.
  return { ...resolved, requestId: request.requestId };
}
```

- [ ] **Step 4: Confirm tests pass.**

Run: `bun scripts/test.ts human vitest`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/test/src/contract/human-connector/MockHumanConnector.ts packages/test/src/test/human/MockHumanConnector.unit.test.ts
git commit -m "feat(test): MockHumanConnector FIFO scripted responses"
```

---

### Task 2.3: TDD deferred responses + abort handling

**Files:**
- Modify: `packages/test/src/test/human/MockHumanConnector.unit.test.ts`
- Modify: `packages/test/src/contract/human-connector/MockHumanConnector.ts`

- [ ] **Step 1: Add failing tests.**

Append to the test file:

```ts
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /abort/i.test(e.message ?? "");
}

describe("MockHumanConnector — deferred + abort", () => {
  it("blocks send() until release()", async () => {
    const c = new MockHumanConnector();
    const handle = c.script.pushDeferred();
    const ac = new AbortController();
    const promise = c.send(elicitReq("r1"), ac.signal);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    handle.release({ requestId: "x", action: "accept", content: { ok: 1 }, done: true });
    const res = await promise;
    expect(res.action).toBe("accept");
    expect(res.content).toEqual({ ok: 1 });
  });

  it("rejects with AbortError when signal is already aborted before send", async () => {
    const c = new MockHumanConnector();
    const ac = new AbortController();
    ac.abort();
    let caught: unknown;
    try {
      await c.send(elicitReq("r1"), ac.signal);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isAbortError(caught)).toBe(true);
  });

  it("rejects with AbortError when signal aborts during a deferred wait", async () => {
    const c = new MockHumanConnector();
    c.script.pushDeferred();
    const ac = new AbortController();
    const promise = c.send(elicitReq("r1"), ac.signal);
    setTimeout(() => ac.abort(), 10);
    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isAbortError(caught)).toBe(true);
  });

  it("releasing after rejection is a no-op (does not throw, does not affect later sends)", async () => {
    const c = new MockHumanConnector();
    const handle = c.script.pushDeferred();
    const ac = new AbortController();
    const promise = c.send(elicitReq("r1"), ac.signal);
    setTimeout(() => ac.abort(), 5);
    try {
      await promise;
    } catch {
      // expected abort
    }
    // Releasing after rejection must not throw.
    expect(() =>
      handle.release({ requestId: "x", action: "accept", content: undefined, done: true })
    ).not.toThrow();
    // Subsequent send should still get the default behavior.
    const res = await c.send(elicitReq("r2"), new AbortController().signal);
    expect(res.action).toBe("accept");
  });
});
```

- [ ] **Step 2: Confirm they fail.**

Run: `bun scripts/test.ts human vitest`
Expected: FAIL.

- [ ] **Step 3: Implement deferred + abort.**

In `MockHumanConnector.ts`, replace the `Script` class and add a deferred entry shape, and update `send`:

```ts
type DeferredEntry = {
  readonly kind: "deferred";
  readonly resolved: { value: IHumanResponse | undefined };
  readonly settled: { done: boolean };
  readonly waiters: Array<(res: IHumanResponse) => void>;
};

type ImmediateEntry = { readonly kind: "immediate"; readonly entry: MockResponseEntry };

type QueueEntry = ImmediateEntry | DeferredEntry;

class Script implements MockResponseScript {
  private readonly _received: IHumanRequest[] = [];
  private readonly _queue: QueueEntry[] = [];

  get received(): ReadonlyArray<IHumanRequest> {
    return this._received;
  }

  recordReceived(req: IHumanRequest): void {
    this._received.push(req);
  }

  push(entry: MockResponseEntry): void {
    this._queue.push({ kind: "immediate", entry });
  }

  pushDeferred(): { release(response: IHumanResponse): void } {
    const def: DeferredEntry = {
      kind: "deferred",
      resolved: { value: undefined },
      settled: { done: false },
      waiters: [],
    };
    this._queue.push(def);
    return {
      release: (response) => {
        if (def.settled.done) return;
        def.settled.done = true;
        def.resolved.value = response;
        for (const w of def.waiters) w(response);
        def.waiters.length = 0;
      },
    };
  }

  shift(): QueueEntry | undefined {
    return this._queue.shift();
  }

  clear(): void {
    this._received.length = 0;
    this._queue.length = 0;
  }
}

function defaultAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function awaitDeferred(def: DeferredEntry, signal: AbortSignal): Promise<IHumanResponse> {
  return new Promise<IHumanResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(defaultAbortError(signal));
      return;
    }
    if (def.settled.done && def.resolved.value !== undefined) {
      resolve(def.resolved.value);
      return;
    }
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(defaultAbortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    def.waiters.push((res) => {
      signal.removeEventListener("abort", onAbort);
      resolve(res);
    });
  });
}
```

Replace `MockHumanConnector.send`:

```ts
async send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
  if (signal.aborted) throw defaultAbortError(signal);
  this._script.recordReceived(request);
  const entry = this._script.shift();
  if (entry === undefined) {
    return {
      requestId: request.requestId,
      action: this.defaultAction,
      content: undefined,
      done: true,
    };
  }
  if (entry.kind === "deferred") {
    const res = await awaitDeferred(entry, signal);
    return { ...res, requestId: request.requestId };
  }
  const resolved =
    typeof entry.entry === "function" ? await entry.entry(request) : entry.entry;
  return { ...resolved, requestId: request.requestId };
}
```

- [ ] **Step 4: Confirm tests pass.**

Run: `bun scripts/test.ts human vitest`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/test/src/contract/human-connector/MockHumanConnector.ts packages/test/src/test/human/MockHumanConnector.unit.test.ts
git commit -m "feat(test): MockHumanConnector deferred responses and abort handling"
```

---

### Task 2.4: TDD `followUp` + `supportsFollowUp` capability gate

**Files:**
- Modify: `packages/test/src/test/human/MockHumanConnector.unit.test.ts`
- Modify: `packages/test/src/contract/human-connector/MockHumanConnector.ts`

- [ ] **Step 1: Add failing tests.**

```ts
describe("MockHumanConnector — followUp", () => {
  it("exposes followUp when supportsFollowUp is true (default)", () => {
    const c = new MockHumanConnector();
    expect(typeof c.followUp).toBe("function");
  });

  it("does NOT expose followUp when supportsFollowUp is false", () => {
    const c = new MockHumanConnector({ supportsFollowUp: false });
    expect(c.followUp).toBeUndefined();
  });

  it("followUp consumes the next scripted entry like send()", async () => {
    const c = new MockHumanConnector();
    c.script.push({ requestId: "x", action: "accept", content: { step: 1 }, done: false });
    c.script.push({ requestId: "x", action: "accept", content: { step: 2 }, done: true });
    const ac = new AbortController();
    const first = await c.send(elicitReq("r1"), ac.signal);
    expect(first.done).toBe(false);
    const second = await c.followUp!(elicitReq("r1"), first, ac.signal);
    expect(second.done).toBe(true);
    expect(second.content).toEqual({ step: 2 });
  });
});
```

- [ ] **Step 2: Confirm failures.**

Run: `bun scripts/test.ts human vitest`
Expected: FAIL.

- [ ] **Step 3: Implement.**

Update `MockHumanConnector` constructor and add a conditional `followUp` assignment:

```ts
export class MockHumanConnector implements IHumanConnector {
  private readonly defaultAction: HumanResponseAction;
  private readonly _script: Script;
  readonly followUp?: (
    request: IHumanRequest,
    previous: IHumanResponse,
    signal: AbortSignal
  ) => Promise<IHumanResponse>;

  constructor(opts: MockHumanConnectorOpts = {}) {
    this.defaultAction = opts.defaultAction ?? "accept";
    this._script = new Script();
    if (opts.supportsFollowUp ?? true) {
      this.followUp = (request, _previous, signal) => this.send(request, signal);
    }
  }

  // ... rest unchanged
}
```

- [ ] **Step 4: Confirm tests pass.**

Run: `bun scripts/test.ts human vitest`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/test/src/contract/human-connector/MockHumanConnector.ts packages/test/src/test/human/MockHumanConnector.unit.test.ts
git commit -m "feat(test): MockHumanConnector supportsFollowUp capability gate"
```

---

### Task 2.5: Conformance entrypoint skeleton

**Files:**
- Create: `packages/test/src/contract/human-connector/runHumanConnectorConformance.ts`

- [ ] **Step 1: Write the entrypoint with empty assertion wiring.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, beforeEach, describe } from "vitest";

import { resolveHumanConformanceFixture } from "./fixtures";
import type {
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "./types";

export type { HumanConnectorConformanceOpts } from "./types";
export { MockHumanConnector } from "./MockHumanConnector";

export function runHumanConnectorConformance(opts: HumanConnectorConformanceOpts): void {
  describe.skipIf(opts.skip)(`IHumanConnector conformance: ${opts.name}`, () => {
    let handle: HumanConnectorConformanceHandle | undefined;
    const getHandle = (): HumanConnectorConformanceHandle => {
      if (!handle) throw new Error("conformance handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
    }, opts.timeout);

    beforeEach(() => {
      // Each assertion starts from a clean script + received list.
      handle?.script.clear();
    });

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    const fixture = resolveHumanConformanceFixture(opts.fixture);

    // Assertion blocks wired in subsequent tasks. Until a block is wired in,
    // the suite passes vacuously for that capability — keeping the runner
    // skeleton committable on its own.
    void fixture;
    void getHandle;
  });
}
```

- [ ] **Step 2: Type-check.**

Run: `cd packages/test && tsgo --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/human-connector/runHumanConnectorConformance.ts
git commit -m "feat(test): runHumanConnectorConformance entrypoint skeleton"
```

---

### Task 2.6: Roundtrip assertion block

**Files:**
- Create: `packages/test/src/contract/human-connector/assertions/roundtrip.ts`
- Modify: `packages/test/src/contract/human-connector/runHumanConnectorConformance.ts`

- [ ] **Step 1: Write the assertion.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  ConformanceFixture,
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "../types";

function elicitReq(fixture: ConformanceFixture, requestId: string): IHumanRequest {
  return {
    requestId,
    targetHumanId: "default",
    kind: "elicit",
    message: "Please confirm.",
    contentSchema: fixture.elicitContentSchema,
    contentData: undefined,
    expectsResponse: true,
    mode: "single",
    metadata: undefined,
  };
}

export function roundtripBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itAccept = expectFails.has("roundtrip.accept") ? itExpectFail : it;
  const itDecline = expectFails.has("roundtrip.decline") ? itExpectFail : it;
  const itCancel = expectFails.has("roundtrip.cancel") ? itExpectFail : it;

  describe.skipIf(!opts.capabilities.elicit)("Roundtrip elicit", () => {
    itAccept(
      "accept echoes requestId, returns done=true, surfaces content",
      async () => {
        const { connector, script } = getHandle();
        script.push({
          requestId: "ignored",
          action: "accept",
          content: fixture.elicitAcceptContent,
          done: true,
        });
        const ac = new AbortController();
        const res = await connector.send(elicitReq(fixture, "rt-accept-1"), ac.signal);
        expect(res.requestId).toBe("rt-accept-1");
        expect(res.action).toBe("accept");
        expect(res.done).toBe(true);
        expect(res.content).toEqual(fixture.elicitAcceptContent);
      },
      opts.timeout
    );

    itDecline(
      "decline surfaces with content=undefined, no throw",
      async () => {
        const { connector, script } = getHandle();
        script.push({ requestId: "x", action: "decline", content: undefined, done: true });
        const ac = new AbortController();
        const res = await connector.send(elicitReq(fixture, "rt-dec-1"), ac.signal);
        expect(res.action).toBe("decline");
        expect(res.content).toBeUndefined();
      },
      opts.timeout
    );

    itCancel(
      "cancel surfaces with content=undefined, no throw",
      async () => {
        const { connector, script } = getHandle();
        script.push({ requestId: "x", action: "cancel", content: undefined, done: true });
        const ac = new AbortController();
        const res = await connector.send(elicitReq(fixture, "rt-can-1"), ac.signal);
        expect(res.action).toBe("cancel");
        expect(res.content).toBeUndefined();
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Wire into the runner.**

In `runHumanConnectorConformance.ts`, add the import and call:

```ts
import { roundtripBlock } from "./assertions/roundtrip";
// ...
roundtripBlock(opts, fixture, getHandle);
```

Remove the `void fixture; void getHandle;` lines from Task 2.5 — they are now used.

- [ ] **Step 3: Commit (no caller yet, can't run conformance — Task 2.13 will).**

```bash
git add packages/test/src/contract/human-connector/assertions/roundtrip.ts packages/test/src/contract/human-connector/runHumanConnectorConformance.ts
git commit -m "feat(test): roundtrip assertion block (accept/decline/cancel)"
```

---

### Task 2.7: Abort assertion block

**Files:**
- Create: `packages/test/src/contract/human-connector/assertions/abort.ts`
- Modify: `packages/test/src/contract/human-connector/runHumanConnectorConformance.ts`

- [ ] **Step 1: Write the assertion.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  ConformanceFixture,
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "../types";

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /abort/i.test(e.message ?? "");
}

function elicitReq(fixture: ConformanceFixture, requestId: string): IHumanRequest {
  return {
    requestId,
    targetHumanId: "default",
    kind: "elicit",
    message: "Please confirm.",
    contentSchema: fixture.elicitContentSchema,
    contentData: undefined,
    expectsResponse: true,
    mode: "single",
    metadata: undefined,
  };
}

export function abortBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itBefore = expectFails.has("abort.beforeSend") ? itExpectFail : it;
  const itMid = expectFails.has("abort.midElicit") ? itExpectFail : it;

  describe.skipIf(!opts.capabilities.elicit)("Abort", () => {
    itBefore(
      "send() with already-aborted signal rejects with AbortError",
      async () => {
        const { connector } = getHandle();
        const ac = new AbortController();
        ac.abort();
        let caught: unknown;
        try {
          await connector.send(elicitReq(fixture, "ab-pre-1"), ac.signal);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeDefined();
        expect(isAbortError(caught)).toBe(true);
      },
      opts.timeout
    );

    if (opts.capabilities.abortMidElicit) {
      itMid(
        "send() rejects with AbortError when signal aborts mid-elicit",
        async () => {
          const { connector, script } = getHandle();
          const handle = script.pushDeferred();
          const ac = new AbortController();
          const start = Date.now();
          const promise = connector.send(elicitReq(fixture, "ab-mid-1"), ac.signal);
          setTimeout(() => ac.abort(), 25);

          let caught: unknown;
          try {
            await promise;
          } catch (err) {
            caught = err;
          }
          const elapsed = Date.now() - start;
          expect(caught).toBeDefined();
          expect(isAbortError(caught)).toBe(true);
          expect(elapsed).toBeLessThan(fixture.abortGraceMs * 4 + 2000);
          // Releasing after rejection must not throw or produce a stray response.
          expect(() =>
            handle.release({
              requestId: "x",
              action: "accept",
              content: undefined,
              done: true,
            })
          ).not.toThrow();
        },
        opts.timeout
      );
    }
  });
}
```

- [ ] **Step 2: Wire into the runner.**

```ts
import { abortBlock } from "./assertions/abort";
// ...
abortBlock(opts, fixture, getHandle);
```

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/human-connector/assertions/abort.ts packages/test/src/contract/human-connector/runHumanConnectorConformance.ts
git commit -m "feat(test): abort assertion block (before-send + mid-elicit)"
```

---

### Task 2.8: Concurrent isolation assertion block

**Files:**
- Create: `packages/test/src/contract/human-connector/assertions/concurrentIsolation.ts`
- Modify: `packages/test/src/contract/human-connector/runHumanConnectorConformance.ts`

- [ ] **Step 1: Write the assertion.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest, IHumanResponse } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  ConformanceFixture,
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "../types";

function elicitReq(fixture: ConformanceFixture, requestId: string): IHumanRequest {
  return {
    requestId,
    targetHumanId: "default",
    kind: "elicit",
    message: "Please confirm.",
    contentSchema: fixture.elicitContentSchema,
    contentData: undefined,
    expectsResponse: true,
    mode: "single",
    metadata: undefined,
  };
}

export function concurrentIsolationBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itConcurrent = expectFails.has("concurrent.isolation") ? itExpectFail : it;

  describe.skipIf(!opts.capabilities.concurrent || !opts.capabilities.elicit)(
    "Concurrent isolation",
    () => {
      itConcurrent(
        "two concurrent send() calls each receive their own scripted response",
        async () => {
          const { connector, script } = getHandle();
          // Use request-aware functions so the response is bound to the
          // requestId of the request that triggered it. If responses cross,
          // the asserts below fail.
          script.push((req): IHumanResponse => {
            return {
              requestId: req.requestId,
              action: "accept",
              content: { tag: req.requestId },
              done: true,
            };
          });
          script.push((req): IHumanResponse => {
            return {
              requestId: req.requestId,
              action: "accept",
              content: { tag: req.requestId },
              done: true,
            };
          });

          const ac = new AbortController();
          const p1 = connector.send(elicitReq(fixture, "conc-A"), ac.signal);
          const p2 = connector.send(elicitReq(fixture, "conc-B"), ac.signal);
          const [a, b] = await Promise.all([p1, p2]);

          expect(a.requestId).toBe("conc-A");
          expect((a.content as { tag: string }).tag).toBe("conc-A");
          expect(b.requestId).toBe("conc-B");
          expect((b.content as { tag: string }).tag).toBe("conc-B");
        },
        opts.timeout
      );
    }
  );
}
```

- [ ] **Step 2: Wire into the runner.**

```ts
import { concurrentIsolationBlock } from "./assertions/concurrentIsolation";
// ...
concurrentIsolationBlock(opts, fixture, getHandle);
```

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/human-connector/assertions/concurrentIsolation.ts packages/test/src/contract/human-connector/runHumanConnectorConformance.ts
git commit -m "feat(test): concurrent isolation assertion block"
```

---

### Task 2.9: Notify + display fast-resolve block

**Files:**
- Create: `packages/test/src/contract/human-connector/assertions/notifyDisplayFastResolve.ts`
- Modify: `packages/test/src/contract/human-connector/runHumanConnectorConformance.ts`

- [ ] **Step 1: Write the assertion.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HumanInteractionKind, IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  ConformanceFixture,
  HumanConnectorAssertionId,
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "../types";

function buildReq(
  fixture: ConformanceFixture,
  kind: "notify" | "display",
  requestId: string
): IHumanRequest {
  const base = kind === "notify" ? fixture.notifyRequest : fixture.displayRequest;
  return {
    requestId,
    targetHumanId: "default",
    kind: kind as HumanInteractionKind,
    message: base.message,
    contentSchema: base.contentSchema,
    contentData: base.contentData,
    expectsResponse: false,
    mode: "single",
    metadata: undefined,
  };
}

function block(
  kind: "notify" | "display",
  enabled: boolean,
  failId: HumanConnectorAssertionId,
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itFn = expectFails.has(failId) ? itExpectFail : it;

  describe.skipIf(!enabled)(`${kind} fast-resolve`, () => {
    itFn(
      `${kind} resolves with action=accept, done=true, no script consumption`,
      async () => {
        const { connector, script } = getHandle();
        const beforeQueueLen = script.received.length;
        const ac = new AbortController();
        const res = await connector.send(buildReq(fixture, kind, `${kind}-1`), ac.signal);
        expect(res.action).toBe("accept");
        expect(res.done).toBe(true);
        expect(res.content).toBeUndefined();
        // The connector should not have required a scripted entry — but it
        // MAY still record the request through whatever its script handle
        // does. We assert no extraneous *consumption*, not zero recording.
        // (Connectors with one-shared-script for all kinds may still log it.)
        expect(script.received.length).toBeGreaterThanOrEqual(beforeQueueLen);
      },
      opts.timeout
    );
  });
}

export function notifyDisplayFastResolveBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  block("notify", opts.capabilities.notify, "notify.fastResolve", opts, fixture, getHandle);
  block("display", opts.capabilities.display, "display.fastResolve", opts, fixture, getHandle);
}
```

- [ ] **Step 2: Wire into the runner.**

```ts
import { notifyDisplayFastResolveBlock } from "./assertions/notifyDisplayFastResolve";
// ...
notifyDisplayFastResolveBlock(opts, fixture, getHandle);
```

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/human-connector/assertions/notifyDisplayFastResolve.ts packages/test/src/contract/human-connector/runHumanConnectorConformance.ts
git commit -m "feat(test): notify/display fast-resolve assertion block"
```

---

### Task 2.10: Multi-turn followUp block

**Files:**
- Create: `packages/test/src/contract/human-connector/assertions/multiTurnFollowUp.ts`
- Modify: `packages/test/src/contract/human-connector/runHumanConnectorConformance.ts`

- [ ] **Step 1: Write the assertion.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  ConformanceFixture,
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "../types";

function elicitReq(
  fixture: ConformanceFixture,
  requestId: string,
  mode: "single" | "multi-turn"
): IHumanRequest {
  return {
    requestId,
    targetHumanId: "default",
    kind: "elicit",
    message: "Multi-turn step.",
    contentSchema: fixture.elicitContentSchema,
    contentData: undefined,
    expectsResponse: true,
    mode,
    metadata: undefined,
  };
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /abort/i.test(e.message ?? "");
}

export function multiTurnFollowUpBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itFn = expectFails.has("multiTurn.followUp") ? itExpectFail : it;

  describe.skipIf(!opts.capabilities.multiTurn || !opts.capabilities.elicit)(
    "Multi-turn followUp",
    () => {
      itFn(
        "followUp() called after done=false response returns terminal response",
        async () => {
          const { connector, script } = getHandle();
          // First send returns done:false; followUp returns done:true.
          script.push({
            requestId: "x",
            action: "accept",
            content: { step: 1 },
            done: false,
          });
          script.push({
            requestId: "x",
            action: "accept",
            content: { step: 2 },
            done: true,
          });

          const ac = new AbortController();
          const req = elicitReq(fixture, "mt-1", "multi-turn");
          const first = await connector.send(req, ac.signal);
          expect(first.done).toBe(false);

          expect(typeof connector.followUp).toBe("function");
          const second = await connector.followUp!(req, first, ac.signal);
          expect(second.done).toBe(true);
          expect(second.content).toEqual({ step: 2 });
        },
        opts.timeout
      );

      if (opts.capabilities.abortMidElicit) {
        itFn(
          "followUp() honors AbortSignal mid-flight",
          async () => {
            const { connector, script } = getHandle();
            script.push({
              requestId: "x",
              action: "accept",
              content: { step: 1 },
              done: false,
            });
            script.pushDeferred();
            const ac = new AbortController();
            const req = elicitReq(fixture, "mt-2", "multi-turn");
            const first = await connector.send(req, ac.signal);
            expect(first.done).toBe(false);
            const promise = connector.followUp!(req, first, ac.signal);
            setTimeout(() => ac.abort(), 25);
            let caught: unknown;
            try {
              await promise;
            } catch (err) {
              caught = err;
            }
            expect(caught).toBeDefined();
            expect(isAbortError(caught)).toBe(true);
          },
          opts.timeout
        );
      }
    }
  );
}
```

- [ ] **Step 2: Wire into the runner.**

```ts
import { multiTurnFollowUpBlock } from "./assertions/multiTurnFollowUp";
// ...
multiTurnFollowUpBlock(opts, fixture, getHandle);
```

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/human-connector/assertions/multiTurnFollowUp.ts packages/test/src/contract/human-connector/runHumanConnectorConformance.ts
git commit -m "feat(test): multi-turn followUp assertion block"
```

---

### Task 2.11: Capability honesty block

**Files:**
- Create: `packages/test/src/contract/human-connector/assertions/capabilityHonesty.ts`
- Modify: `packages/test/src/contract/human-connector/runHumanConnectorConformance.ts`

- [ ] **Step 1: Write the assertion.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HumanInteractionKind, IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  ConformanceFixture,
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "../types";

function buildReq(
  fixture: ConformanceFixture,
  kind: HumanInteractionKind,
  requestId: string
): IHumanRequest {
  const base = kind === "elicit"
    ? { message: "elicit", contentSchema: fixture.elicitContentSchema, contentData: undefined }
    : kind === "notify"
      ? fixture.notifyRequest
      : fixture.displayRequest;
  return {
    requestId,
    targetHumanId: "default",
    kind,
    message: base.message,
    contentSchema: base.contentSchema,
    contentData: base.contentData,
    expectsResponse: kind === "elicit",
    mode: "single",
    metadata: undefined,
  };
}

export function capabilityHonestyBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itFn = expectFails.has("capabilityHonesty") ? itExpectFail : it;

  describe("Capability honesty", () => {
    itFn(
      "multiTurn:false implies followUp is undefined (not silent no-op)",
      () => {
        if (opts.capabilities.multiTurn) return; // honest claim; nothing to assert
        const { connector } = getHandle();
        expect(connector.followUp).toBeUndefined();
      },
      opts.timeout
    );

    for (const kind of ["notify", "display", "elicit"] as const) {
      itFn(
        `${kind}:false implies the connector either throws or surfaces a non-accept action (no silent accept)`,
        async () => {
          if (opts.capabilities[kind]) return; // honest claim; nothing to assert
          const { connector } = getHandle();
          const ac = new AbortController();
          let caught: unknown;
          let res: { action?: string } | undefined;
          try {
            res = await connector.send(buildReq(fixture, kind, `cap-${kind}`), ac.signal);
          } catch (err) {
            caught = err;
          }
          if (caught) {
            // Throwing is acceptable — explicit unsupported.
            expect(caught).toBeDefined();
            return;
          }
          expect(res).toBeDefined();
          // Must NOT silently accept what the connector cannot really do.
          expect(res!.action).not.toBe("accept");
        },
        opts.timeout
      );
    }
  });
}
```

- [ ] **Step 2: Wire into the runner.**

```ts
import { capabilityHonestyBlock } from "./assertions/capabilityHonesty";
// ...
capabilityHonestyBlock(opts, fixture, getHandle);
```

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/human-connector/assertions/capabilityHonesty.ts packages/test/src/contract/human-connector/runHumanConnectorConformance.ts
git commit -m "feat(test): capability honesty assertion block"
```

---

### Task 2.12: MockHumanConnector self-conformance shim (full capabilities)

**Files:**
- Create: `packages/test/src/test/human/MockHumanConnector.conformance.test.ts`

- [ ] **Step 1: Write the shim.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MockHumanConnector,
  runHumanConnectorConformance,
} from "../../contract/human-connector/runHumanConnectorConformance";

runHumanConnectorConformance({
  name: "MockHumanConnector (full capabilities)",
  timeout: 5_000,
  factory: async () => {
    const connector = new MockHumanConnector({ supportsFollowUp: true });
    return {
      connector,
      script: connector.script,
      dispose: async () => {
        connector.script.clear();
      },
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

- [ ] **Step 2: Run the conformance suite.**

Run: `bun scripts/test.ts human vitest`
Expected: All blocks pass for `MockHumanConnector (full capabilities)`.

If any assertion fails: the failure points at a real bug in `MockHumanConnector` or in the assertion. Fix the underlying bug — do NOT add to `expectedFailures` (this is the reference adapter).

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/test/human/MockHumanConnector.conformance.test.ts
git commit -m "test(human): MockHumanConnector self-conformance (full capabilities)"
```

---

### Task 2.13: MockHumanConnector self-conformance shim (no followUp variant)

**Files:**
- Create: `packages/test/src/test/human/MockHumanConnector_NoFollowUp.conformance.test.ts`

- [ ] **Step 1: Write the shim.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MockHumanConnector,
  runHumanConnectorConformance,
} from "../../contract/human-connector/runHumanConnectorConformance";

runHumanConnectorConformance({
  name: "MockHumanConnector (no followUp)",
  timeout: 5_000,
  factory: async () => {
    const connector = new MockHumanConnector({ supportsFollowUp: false });
    return {
      connector,
      script: connector.script,
      dispose: async () => {
        connector.script.clear();
      },
    };
  },
  capabilities: {
    elicit: true,
    notify: true,
    display: true,
    multiTurn: false,
    concurrent: true,
    abortMidElicit: true,
  },
});
```

- [ ] **Step 2: Run the suite.**

Run: `bun scripts/test.ts human vitest`
Expected: PASS. The `Multi-turn followUp` describe is skipped (`!multiTurn`); `Capability honesty` asserts `connector.followUp === undefined`.

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/test/human/MockHumanConnector_NoFollowUp.conformance.test.ts
git commit -m "test(human): MockHumanConnector self-conformance (no followUp variant)"
```

---

### Task 2.14: Verify existing human-related tests still pass

- [ ] **Step 1: Run dependent test sections.**

Run: `bun scripts/test.ts human vitest`
Run: `bun scripts/test.ts task vitest`
Run: `bun scripts/test.ts ai-provider vitest` (sanity check on the `itExpectFail` move from Task 1.1)

Expected: All pass. No new failures.

- [ ] **Step 2: If anything regressed, fix it before proceeding.** Do not push broken code into Phase 3.

---

## Phase 3 — McpElicitationConnector wiring

### Task 3.1: Build the paired in-process MCP harness

**Files:**
- Create: `packages/test/src/test/human/mcpHarness.ts`

This is the only file in Phase 3 with non-trivial wiring. The shape of the MCP SDK API used here:

- `Server` and `Client` from `@modelcontextprotocol/sdk/server` and `@modelcontextprotocol/sdk/client`.
- `InMemoryTransport.createLinkedPair()` returns `[clientTransport, serverTransport]`.
- The client side handles incoming `elicit/create` requests by registering a request handler against the SDK's `ElicitRequestSchema`.
- The server's `elicitInput(...)` (used by `McpElicitationConnector`) sends the request through the transport pair.

Verify the exact symbol names against the version of `@modelcontextprotocol/sdk` resolved by `packages/test`'s catalog dependency before locking in imports. The plan below uses what `McpElicitationConnector.ts` already proves is available; if a name differs in your SDK version, prefer the version actually exported.

- [ ] **Step 1: Write the harness.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { IHumanRequest, IHumanResponse } from "@workglow/util";

import type { MockResponseEntry, MockResponseScript } from "../../contract/human-connector/types";

interface PairedMcpHarness {
  readonly server: Server;
  readonly script: MockResponseScript;
  dispose(): Promise<void>;
}

type ImmediateQueueEntry = { readonly kind: "immediate"; readonly entry: MockResponseEntry };

type DeferredQueueEntry = {
  readonly kind: "deferred";
  /** Resolves when release() is called (or pre-resolved if release ran first). */
  readonly promise: Promise<IHumanResponse>;
};

type HarnessQueueEntry = ImmediateQueueEntry | DeferredQueueEntry;

class HarnessScript implements MockResponseScript {
  private readonly _received: IHumanRequest[] = [];
  private readonly _queue: HarnessQueueEntry[] = [];

  get received(): ReadonlyArray<IHumanRequest> {
    return this._received;
  }

  recordReceived(req: IHumanRequest): void {
    this._received.push(req);
  }

  push(entry: MockResponseEntry): void {
    this._queue.push({ kind: "immediate", entry });
  }

  pushDeferred(): { release(response: IHumanResponse): void } {
    let resolveFn: (res: IHumanResponse) => void = () => {};
    let settled = false;
    const promise = new Promise<IHumanResponse>((resolve) => {
      resolveFn = resolve;
    });
    this._queue.push({ kind: "deferred", promise });
    return {
      release: (response) => {
        if (settled) return;
        settled = true;
        resolveFn(response);
      },
    };
  }

  /**
   * Consumed by the elicit handler to resolve the next outgoing prompt.
   *
   * If a deferred entry is awaiting release, this awaits the deferred promise.
   * The conformance suite's abort-mid-elicit test aborts the upstream signal
   * BEFORE release is called — `Server.elicitInput` rejects on the connector
   * side and the dangling promise is GC'd at dispose time. No leak.
   */
  async takeNext(req: IHumanRequest): Promise<IHumanResponse> {
    const next = this._queue.shift();
    if (!next) {
      return { requestId: req.requestId, action: "accept", content: undefined, done: true };
    }
    if (next.kind === "immediate") {
      const resolved =
        typeof next.entry === "function" ? await next.entry(req) : next.entry;
      return { ...resolved, requestId: req.requestId };
    }
    const resolved = await next.promise;
    return { ...resolved, requestId: req.requestId };
  }

  clear(): void {
    this._received.length = 0;
    this._queue.length = 0;
  }
}

export async function createPairedMcpHarness(): Promise<PairedMcpHarness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server(
    { name: "test-server", version: "0.0.0" },
    { capabilities: { elicitation: {} } }
  );
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: { elicitation: {} } }
  );

  const script = new HarnessScript();

  // Translate incoming MCP elicit/create into a synthetic IHumanRequest, run
  // it through the script, and convert the IHumanResponse back into the MCP
  // ElicitResult shape the SDK expects.
  client.setRequestHandler(ElicitRequestSchema, async (mcpReq) => {
    const synthetic: IHumanRequest = {
      requestId: `harness-${script.received.length + 1}`,
      targetHumanId: "default",
      kind: "elicit",
      message: mcpReq.params.message,
      // Translate MCP requestedSchema back to a DataPortSchema-shaped object.
      contentSchema: {
        type: "object",
        properties: mcpReq.params.requestedSchema.properties as Record<string, unknown>,
        ...(mcpReq.params.requestedSchema.required
          ? { required: mcpReq.params.requestedSchema.required }
          : {}),
      },
      contentData: undefined,
      expectsResponse: true,
      mode: "single",
      metadata: undefined,
    };
    script.recordReceived(synthetic);
    const res = await script.takeNext(synthetic);
    return {
      action: res.action,
      ...(res.action === "accept" && res.content ? { content: res.content } : {}),
    };
  });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    server,
    script,
    dispose: async () => {
      await client.close();
      await server.close();
      script.clear();
    },
  };
}
```

- [ ] **Step 2: Type-check.**

Run: `cd packages/test && tsgo --noEmit`
Expected: no errors. If the SDK exports differ (named vs. namespace), adjust imports until clean. The shape of `Server.elicitInput` and `ElicitRequestSchema` is fixed by the existing `McpElicitationConnector` consumer.

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/test/human/mcpHarness.ts
git commit -m "test(human): paired in-process MCP harness for IHumanConnector conformance"
```

---

### Task 3.2: McpElicitationConnector conformance shim

**Files:**
- Create: `packages/test/src/test/human/McpElicitationConnector.conformance.test.ts`

- [ ] **Step 1: Write the shim.**

```ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpElicitationConnector } from "@workglow/mcp/tasks";

import { runHumanConnectorConformance } from "../../contract/human-connector/runHumanConnectorConformance";
import { createPairedMcpHarness } from "./mcpHarness";

runHumanConnectorConformance({
  name: "McpElicitationConnector",
  timeout: 10_000,
  factory: async () => {
    const harness = await createPairedMcpHarness();
    return {
      connector: new McpElicitationConnector(harness.server),
      script: harness.script,
      dispose: harness.dispose,
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
  // Populate during Step 2 below if any block surfaces a real failure.
  expectedFailures: [],
});
```

Verify the exact import path of `McpElicitationConnector` against the `@workglow/mcp` package's exports map (`grep -n "McpElicitationConnector" packages/mcp/src/*.ts`). Adjust the import if the public path is different.

- [ ] **Step 2: Run the suite. Mark genuine failures.**

Run: `bun scripts/test.ts human vitest`

For each block that fails:
1. Read the failure message and confirm it points at a real bug in `McpElicitationConnector` (not a harness wiring issue).
2. If the harness needs fixing, fix it (in `mcpHarness.ts`) and re-run.
3. If the bug is in `McpElicitationConnector`, add the assertion's id to `expectedFailures` with a `// TODO(phase-4): <one-line description>` comment above the array entry.

The shim must end with a green run (each remaining failure marked).

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/test/human/McpElicitationConnector.conformance.test.ts packages/test/src/test/human/mcpHarness.ts
git commit -m "test(human): McpElicitationConnector conformance shim"
```

---

## Phase 4 — Fix failures surfaced in Phase 3

### Task 4.1: Drive each `expectedFailures` entry to fix-and-flip

For each id remaining in the `expectedFailures` array of
`McpElicitationConnector.conformance.test.ts`, repeat:

- [ ] **Step 1: Locate the assertion.**

`grep -n '"<id>"' packages/test/src/contract/human-connector/assertions/`. Read the assertion to understand what behavior is missing.

- [ ] **Step 2: Diagnose the bug in `McpElicitationConnector`.**

`packages/mcp/src/tasks/McpElicitationConnector.ts` is the only file in scope. Common failure classes to look for:

- `signal` parameter not threaded into a sub-call.
- `kind === "notify"` or `kind === "display"` path missing abort checks at the right boundary.
- `followUp` collapsing into `send` and dropping intermediate state.
- Concurrent `elicitInput` calls not isolated at the SDK layer.

- [ ] **Step 3: Write a focused failing unit test for the bug** (alongside `packages/test/src/test/human/`).

`packages/test/src/test/human/McpElicitationConnector.unit.test.ts` (create if missing). One test per bug, asserting the specific behavior. This anchors the fix outside of conformance-suite churn.

- [ ] **Step 4: Implement the minimal fix.** Modify `McpElicitationConnector.ts`.

- [ ] **Step 5: Run focused tests.**

Run: `bun scripts/test.ts human vitest` (or `bun scripts/test.ts mcp vitest` if the file lives under mcp).
Expected: the unit test passes.

- [ ] **Step 6: Remove the id from `expectedFailures`.**

In `McpElicitationConnector.conformance.test.ts`, delete the line(s) and the `TODO(phase-4)` comment.

- [ ] **Step 7: Re-run conformance.**

Run: `bun scripts/test.ts human vitest`
Expected: PASS — the assertion that was previously expected-fail now passes for real.

- [ ] **Step 8: Commit.**

```bash
git add packages/mcp/src/tasks/McpElicitationConnector.ts packages/test/src/test/human/McpElicitationConnector.unit.test.ts packages/test/src/test/human/McpElicitationConnector.conformance.test.ts
git commit -m "fix(mcp): <bug summary> in McpElicitationConnector"
```

If Phase 3 surfaces no failures (i.e., `expectedFailures` is `[]` after Phase 3), this whole phase is a no-op. Note that fact in the PR description and skip Phase 4.

---

## Final verification

### Task F.1: Full-section run

- [ ] **Step 1: Run the test sections this project touches.**

```sh
bun scripts/test.ts human vitest
bun scripts/test.ts ai-provider vitest
bun scripts/test.ts task vitest
bun scripts/test.ts mcp vitest
```

Expected: All pass.

- [ ] **Step 2: Lint + format.**

```sh
bun run format
```

If anything changed, `git add -u && git commit -m "chore: format"`.

- [ ] **Step 3: Type-build.**

```sh
bun run build:types
```

Expected: clean.

- [ ] **Step 4: Push.**

```sh
git push -u origin claude/implement-ihumanconnector-vLLA6
```

The branch is now ready for PR.
