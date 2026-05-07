# IBrowserContext Contract Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parameterized contract conformance suite for `IBrowserContext` in `@workglow/test`, run it against four adapters (Mock, Playwright, BunWebView, Electron), and fix the three known IBrowserContext bugs the suite detects.

**Architecture:** Mirror the existing `runAiProviderConformance` pattern under `packages/test/src/contract/browser-context/`. Single entrypoint `runIBrowserContextConformance(opts)` defines a `describe.skipIf` and dispatches to four assertion blocks (capability honesty, tabs lifecycle, ARIA round-trip, network introspection). Each adapter is wired via a thin `*_Generic.integration.test.ts` shim under `packages/test/src/test/browser/`. Known bugs are captured as `expectedFailures` entries until Phase 4 fixes them.

**Tech Stack:** TypeScript, Vitest, Bun workspaces, Playwright, Bun.WebView (CDP), Electron (CDP), `@workglow/browser-control`.

**Spec:** `docs/superpowers/specs/2026-05-07-ibrowsercontext-contract-conformance-design.md`

---

## File map

**Created:**
- `packages/test/src/contract/browser-context/types.ts` — `IBrowserContextConformanceOpts`, `BrowserContextHandle`, `BrowserContextCapabilities`, `BrowserContextFixture`.
- `packages/test/src/contract/browser-context/fixtures.ts` — `DEFAULT_FIXTURE`, `resolveFixture`, the data: URL HTML.
- `packages/test/src/contract/browser-context/runIBrowserContextConformance.ts` — entrypoint.
- `packages/test/src/contract/browser-context/assertions/itExpectFail.ts` — copy of the AiProvider helper.
- `packages/test/src/contract/browser-context/assertions/capabilityHonesty.ts` — negative + positive capability honesty.
- `packages/test/src/contract/browser-context/assertions/tabsLifecycle.ts` — basic + concurrent-close stability.
- `packages/test/src/contract/browser-context/assertions/ariaRoundTrip.ts` — snapshot ↔ ref round-trip + ref reuse.
- `packages/test/src/contract/browser-context/assertions/networkIntrospection.ts` — fixture fetch is observable.
- `packages/test/src/contract/browser-context/ConformanceMockContext.ts` — purpose-built in-memory `IBrowserContext` for the Mock shim. Distinct from existing `MockBrowserContext` (call recorder, used by Tasks unit tests).
- `packages/test/src/test/browser/MockBrowser_Generic.test.ts` — shim using `ConformanceMockContext`.
- `packages/test/src/test/browser/Playwright_Generic.integration.test.ts` — shim.
- `packages/test/src/test/browser/BunWebView_Generic.integration.test.ts` — shim.
- `packages/test/src/test/browser/Electron_Generic.integration.test.ts` — shim, gated on `RUN_ELECTRON_TESTS`.

**Modified:**
- `packages/test/src/contract/README.md` — add a row to the "Available suites" table; add a paragraph documenting `create`/`dispose` factory shape as a legitimate variant of `register`/`dispose`/`inspect`.
- `packages/browser-control/src/task/PlaywrightBackend.ts` (Phase 4 only) — three localized fixes.
- `packages/browser-control/src/task/BunWebViewBackend.ts` (Phase 4 only) — delete empty-stub `networkRequests` / `consoleMessages` properties.

**Untouched:**
- `packages/test/src/test/browser/MockBrowserContext.ts` — left alone; existing Tasks unit tests depend on its current shape.
- `packages/test/src/test/browser/genericBrowserTaskTests.ts` — Tasks-layer suite; orthogonal to this contract suite.

---

## Phase 1 — Foundations & fixtures

### Task 1.1: Scaffold the contract directory + types

**Files:**
- Create: `packages/test/src/contract/browser-context/types.ts`
- Create: `packages/test/src/contract/browser-context/assertions/itExpectFail.ts`
- Reference: `packages/test/src/contract/ai-provider/types.ts`, `packages/test/src/contract/ai-provider/assertions/itExpectFail.ts`

- [ ] **Step 1: Copy `itExpectFail.ts` verbatim from `ai-provider/`.**

```ts
// packages/test/src/contract/browser-context/assertions/itExpectFail.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from "vitest";

type ItFn = (name: string, fn: () => Promise<void> | void, timeout?: number) => void;

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

- [ ] **Step 2: Write `types.ts`.**

```ts
// packages/test/src/contract/browser-context/types.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IBrowserContext } from "@workglow/browser-control/task";

export interface IBrowserContextConformanceOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<BrowserContextHandle>;
  readonly capabilities: BrowserContextCapabilities;
  readonly fixture?: Partial<BrowserContextFixture>;
  /**
   * Names of conformance assertions currently broken in this adapter; each
   * named assertion is wrapped in `it.fails` instead of `it`. Remove the
   * entry once the adapter bug is fixed.
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
  readonly networkMarkerUrl: string;
  readonly consoleMarker: string;
  readonly ariaEdgeCaseNames: ReadonlyArray<string>;
}
```

- [ ] **Step 3: Run typecheck to ensure imports resolve.**

Run: `cd packages/test && bun run --filter=@workglow/test build:types 2>&1 | tail -30`
Expected: no errors referencing `browser-context/types.ts` or `itExpectFail.ts`. (Other unrelated errors elsewhere in the repo are not this task's concern.)

- [ ] **Step 4: Commit.**

```bash
git add packages/test/src/contract/browser-context/types.ts \
        packages/test/src/contract/browser-context/assertions/itExpectFail.ts
git commit -m "test(browser-context): add conformance types + itExpectFail helper"
```

---

### Task 1.2: Build the fixture page

**Files:**
- Create: `packages/test/src/contract/browser-context/fixtures.ts`

- [ ] **Step 1: Write `fixtures.ts`.**

The fixture page is a self-contained `data:text/html,...` URL. It embeds a `<button>` per ARIA edge-case name, each with an `onclick` that sets `data-clicked="<idx>"` on `#sentinel`. On load it issues `fetch("data:text/plain,fixture-network-marker")` and `console.log("fixture-console-marker")`.

```ts
// packages/test/src/contract/browser-context/fixtures.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserContextFixture } from "./types";

const ARIA_EDGE_CASE_NAMES: ReadonlyArray<string> = [
  "Sign in",                  // baseline ASCII
  "foo:bar",                  // colon mid-name
  "11:30",                    // ends in colon-digits (lastIndexOf parser)
  "a",                        // single character
  "héllo→",                   // unicode + arrow
  "x".repeat(200),            // long
];

const NETWORK_MARKER = "fixture-network-marker";
const CONSOLE_MARKER = "fixture-console-marker";

function escapeForHtmlAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPageHtml(): string {
  const buttons = ARIA_EDGE_CASE_NAMES.map(
    (name, idx) =>
      `<button type="button" aria-label="${escapeForHtmlAttr(name)}" ` +
      `onclick="document.getElementById('sentinel').setAttribute('data-clicked', '${idx}')">` +
      escapeForHtmlAttr(name) +
      `</button>`
  ).join("");
  const head = "<head><title>IBrowserContext Conformance</title></head>";
  const body =
    `<body>` +
    `<div id="sentinel" data-clicked=""></div>` +
    buttons +
    `<script>` +
    `console.log(${JSON.stringify(CONSOLE_MARKER)});` +
    // Use a benign network target — data: URL keeps the page self-contained.
    `fetch("data:text/plain,${NETWORK_MARKER}").catch(function(){});` +
    `</script>` +
    `</body>`;
  return `<!DOCTYPE html><html>${head}${body}</html>`;
}

const PAGE_URL = `data:text/html,${encodeURIComponent(buildPageHtml())}`;

export const DEFAULT_FIXTURE: BrowserContextFixture = {
  pageUrl: PAGE_URL,
  networkMarkerUrl: NETWORK_MARKER,
  consoleMarker: CONSOLE_MARKER,
  ariaEdgeCaseNames: ARIA_EDGE_CASE_NAMES,
};

export function resolveFixture(
  override: Partial<BrowserContextFixture> | undefined
): BrowserContextFixture {
  if (!override) return DEFAULT_FIXTURE;
  return { ...DEFAULT_FIXTURE, ...override };
}
```

- [ ] **Step 2: Smoke-test the fixture HTML in a Node REPL.**

Run:
```sh
node -e '
const { DEFAULT_FIXTURE } = require("./packages/test/src/contract/browser-context/fixtures.ts");
console.log(DEFAULT_FIXTURE.pageUrl.length, DEFAULT_FIXTURE.ariaEdgeCaseNames.length);
'
```

Skip this step if Node cannot import .ts directly. Instead, run typecheck:
Run: `cd packages/test && bun run build:types 2>&1 | tail -10`
Expected: no errors mentioning `fixtures.ts`.

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/browser-context/fixtures.ts
git commit -m "test(browser-context): add data-URL fixture page with ARIA edge-case names"
```

---

### Task 1.3: Add the runner shell + README entry

**Files:**
- Create: `packages/test/src/contract/browser-context/runIBrowserContextConformance.ts`
- Modify: `packages/test/src/contract/README.md`

- [ ] **Step 1: Write the runner shell with no assertion blocks wired (each block is added in Phase 2 tasks).**

```ts
// packages/test/src/contract/browser-context/runIBrowserContextConformance.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";

import { resolveFixture } from "./fixtures";
import type { IBrowserContextConformanceOpts } from "./types";

export function runIBrowserContextConformance(opts: IBrowserContextConformanceOpts): void {
  describe.skipIf(opts.skip)(`IBrowserContext conformance: ${opts.name}`, () => {
    const fixture = resolveFixture(opts.fixture);

    // Phase 2 wires assertion blocks here. Each block creates its own
    // context via opts.factory() in beforeAll and disposes it in afterAll
    // so block N cannot taint block N+1.
    void fixture;
  });
}
```

- [ ] **Step 2: Update the contract README.**

Add a row to the "Available suites" table (locate the existing markdown table around lines 67-71 of `packages/test/src/contract/README.md`):

```markdown
| `IBrowserContext` | `contract/browser-context/runIBrowserContextConformance` | Mock, Playwright, BunWebView, Electron |
```

Add this paragraph after the "Conventions" section (around line 64), before "Available suites":

```markdown
### Factory shape variants

The `register/dispose/inspect` factory documented above is one of two
legitimate shapes — used when an adapter is a long-lived global registration
(e.g. an AI provider). For contracts whose subject is heavyweight but
per-test state (e.g. browser contexts), prefer a `create/dispose` factory
where each top-level block instantiates its own subject:

    factory: () => Promise<{
      create: () => Promise<TSubject>;
      dispose: (subject: TSubject) => Promise<void>;
    }>

The principle is the same: a fresh handle per block, with no shared state
that block N can leak into block N+1. The methods on the handle are
contract-specific.
```

- [ ] **Step 3: Run typecheck.**

Run: `cd packages/test && bun run build:types 2>&1 | tail -10`
Expected: no errors referencing the new files.

- [ ] **Step 4: Commit.**

```bash
git add packages/test/src/contract/browser-context/runIBrowserContextConformance.ts \
        packages/test/src/contract/README.md
git commit -m "test(browser-context): scaffold conformance runner + README entry"
```

---

## Phase 2 — Suite assertions, Mock shim, Playwright shim

### Task 2.1: ConformanceMockContext (the reference implementation)

**Files:**
- Create: `packages/test/src/contract/browser-context/ConformanceMockContext.ts`

This is a purpose-built in-memory `IBrowserContext` rich enough to satisfy all four assertion blocks. Distinct from the existing `MockBrowserContext` call recorder. It parses the data: URL fixture page on `navigate()`, synthesizes an accessibility tree from the embedded buttons, tracks per-tab state, captures fetches and console messages, and implements click side-effects so the click sentinel works.

- [ ] **Step 1: Write `ConformanceMockContext.ts`.**

```ts
// packages/test/src/contract/browser-context/ConformanceMockContext.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AccessibilityNode,
  AccessibilityTree,
  AriaRole,
  BrowserConnectOptions,
  ClickOptions,
  ConsoleMessage,
  DialogAction,
  DialogInfo,
  DownloadOptions,
  DownloadResult,
  ElementRef,
  IBrowserContext,
  NavigateOptions,
  NetworkFilter,
  NetworkRequest,
  ScreenshotOptions,
  SnapshotOptions,
  TabInfo,
  WaitOptions,
} from "@workglow/browser-control/task";

interface PageState {
  readonly tabId: string;
  url: string;
  title: string;
  ariaButtons: ReadonlyArray<{ readonly idx: number; readonly name: string }>;
  sentinelClicked: string;
  network: NetworkRequest[];
  console: ConsoleMessage[];
}

/**
 * Parses the conformance fixture page out of a `data:text/html,...` URL by
 * scraping aria-label values from `<button ... aria-label="...">` tags. This
 * is intentionally narrow — only the conformance fixture page is supported.
 */
function parseFixturePage(url: string): {
  readonly title: string;
  readonly ariaButtons: ReadonlyArray<{ readonly idx: number; readonly name: string }>;
  readonly networkMarker: string | undefined;
  readonly consoleMarker: string | undefined;
} {
  let html = "";
  if (url.startsWith("data:text/html,")) {
    html = decodeURIComponent(url.slice("data:text/html,".length));
  }
  const titleMatch = /<title>([^<]*)<\/title>/.exec(html);
  const buttons: { idx: number; name: string }[] = [];
  const buttonRe = /<button[^>]*aria-label="([^"]*)"[^>]*>/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = buttonRe.exec(html)) !== null) {
    const decoded = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    buttons.push({ idx, name: decoded });
    idx++;
  }
  const fetchMatch = /fetch\("data:text\/plain,([^"]+)"/.exec(html);
  const consoleMatch = /console\.log\("([^"]+)"\)/.exec(html);
  return {
    title: titleMatch ? titleMatch[1] : "",
    ariaButtons: buttons,
    networkMarker: fetchMatch?.[1],
    consoleMarker: consoleMatch?.[1],
  };
}

export class ConformanceMockContext implements IBrowserContext {
  private connected = false;
  private nextTabSeq = 1;
  private nextRefSeq = 1;
  private pages: PageState[] = [];
  private activeTabId: string | undefined;
  /** ref → { tabId, name } produced by snapshot(). */
  private refMap = new Map<string, { tabId: string; name: string; idx: number }>();

  // networkRequests / consoleMessages are intentionally absent (undefined)
  // when the corresponding capability flag is false. The shim wires this
  // class with capabilities.{networkRequests,consoleMessages}: false, so
  // these properties stay undefined to satisfy capability honesty (negative).

  // -- Lifecycle ------------------------------------------------------------
  async connect(_options?: BrowserConnectOptions): Promise<void> {
    this.connected = true;
    if (this.pages.length === 0) {
      const page = this.makePage("about:blank", "");
      this.pages.push(page);
      this.activeTabId = page.tabId;
    }
  }
  async disconnect(): Promise<void> {
    this.connected = false;
    this.pages = [];
    this.activeTabId = undefined;
    this.refMap.clear();
  }
  isConnected(): boolean {
    return this.connected;
  }

  private makePage(url: string, title: string): PageState {
    return {
      tabId: `mock-tab-${this.nextTabSeq++}`,
      url,
      title,
      ariaButtons: [],
      sentinelClicked: "",
      network: [],
      console: [],
    };
  }

  private active(): PageState {
    const p = this.pages.find((p) => p.tabId === this.activeTabId);
    if (!p) throw new Error("ConformanceMockContext: no active tab");
    return p;
  }

  // -- Navigation -----------------------------------------------------------
  async navigate(url: string, _options?: NavigateOptions): Promise<void> {
    const page = this.active();
    page.url = url;
    const parsed = parseFixturePage(url);
    page.title = parsed.title;
    page.ariaButtons = parsed.ariaButtons;
    page.sentinelClicked = "";
    if (parsed.networkMarker) {
      page.network.push({
        url: `data:text/plain,${parsed.networkMarker}`,
        method: "GET",
        status: 200,
        headers: {},
      });
    }
    if (parsed.consoleMarker) {
      page.console.push({ type: "log", text: parsed.consoleMarker });
    }
  }
  async goBack(): Promise<void> {}
  async goForward(): Promise<void> {}
  async reload(): Promise<void> {}
  async currentUrl(): Promise<string> {
    return this.active().url;
  }
  async title(): Promise<string> {
    return this.active().title;
  }

  // -- Accessibility --------------------------------------------------------
  async snapshot(_options?: SnapshotOptions): Promise<AccessibilityTree> {
    const page = this.active();
    const children: AccessibilityNode[] = page.ariaButtons.map((b) => {
      const ref: ElementRef = `e${this.nextRefSeq++}`;
      this.refMap.set(ref, { tabId: page.tabId, name: b.name, idx: b.idx });
      return { ref, role: "button", name: b.name };
    });
    const rootRef: ElementRef = `e${this.nextRefSeq++}`;
    return {
      root: { ref: rootRef, role: "document", name: page.title, children },
      yaml: children.map((c) => `- button [${c.ref}]: ${c.name}`).join("\n"),
    };
  }

  // -- Element interaction --------------------------------------------------
  async click(ref: ElementRef, _options?: ClickOptions): Promise<void> {
    const entry = this.refMap.get(ref);
    if (!entry) throw new Error(`ConformanceMockContext: unknown ref "${ref}"`);
    const page = this.pages.find((p) => p.tabId === entry.tabId);
    if (!page) throw new Error(`ConformanceMockContext: tab gone for ref "${ref}"`);
    page.sentinelClicked = String(entry.idx);
  }
  async fill(): Promise<void> {}
  async selectOption(): Promise<void> {}
  async hover(): Promise<void> {}

  async clickByRole(role: AriaRole, name: string, _options?: ClickOptions): Promise<void> {
    if (role !== "button") {
      throw new Error(`ConformanceMockContext: unsupported role "${role}"`);
    }
    const page = this.active();
    const btn = page.ariaButtons.find((b) => b.name === name);
    if (!btn) throw new Error(`ConformanceMockContext: no button named ${JSON.stringify(name)}`);
    page.sentinelClicked = String(btn.idx);
  }
  async fillByLabel(): Promise<void> {}

  // -- Content extraction ---------------------------------------------------
  async content(): Promise<string> {
    return "";
  }
  async innerHTML(): Promise<string> {
    return "";
  }
  async textContent(ref: ElementRef): Promise<string | null> {
    const entry = this.refMap.get(ref);
    return entry ? entry.name : null;
  }
  async attribute(ref: ElementRef, name: string): Promise<string | null> {
    if (name === "data-clicked") {
      const entry = this.refMap.get(ref);
      const page = entry && this.pages.find((p) => p.tabId === entry.tabId);
      return page ? page.sentinelClicked : null;
    }
    return null;
  }
  async querySelector(_selector: string): Promise<ElementRef | null> {
    return null;
  }
  async querySelectorAll(): Promise<readonly ElementRef[]> {
    return [];
  }

  async evaluate<T>(expression: string): Promise<T> {
    // Narrow support: the assertion suite reads sentinel via attribute(), not
    // evaluate(), but provide a readiness check used by waitForIdle.
    if (expression.includes("readyState")) return true as unknown as T;
    return undefined as unknown as T;
  }

  async screenshot(_options?: ScreenshotOptions): Promise<Buffer> {
    return Buffer.alloc(0);
  }
  async pressKey(): Promise<void> {}
  async type(): Promise<void> {}
  async scroll(): Promise<void> {}
  async uploadFile(): Promise<void> {}
  async download(
    trigger: () => Promise<void>,
    _options?: DownloadOptions
  ): Promise<DownloadResult> {
    await trigger();
    return { path: "", suggestedFilename: "" };
  }
  onDialog(_handler: (info: DialogInfo) => DialogAction | Promise<DialogAction>): void {}

  // -- Tabs -----------------------------------------------------------------
  async tabs(): Promise<readonly TabInfo[]> {
    return this.pages.map((p) => ({ tabId: p.tabId, url: p.url, title: p.title }));
  }
  async switchTab(tabId: string): Promise<void> {
    if (!this.pages.some((p) => p.tabId === tabId)) {
      throw new Error(`ConformanceMockContext: no tab "${tabId}"`);
    }
    this.activeTabId = tabId;
  }
  async newTab(url?: string): Promise<TabInfo> {
    const page = this.makePage(url ?? "about:blank", "");
    this.pages.push(page);
    if (url) {
      const prev = this.activeTabId;
      this.activeTabId = page.tabId;
      await this.navigate(url);
      this.activeTabId = prev;
    }
    return { tabId: page.tabId, url: page.url, title: page.title };
  }
  async closeTab(tabId: string): Promise<void> {
    const before = this.pages.length;
    this.pages = this.pages.filter((p) => p.tabId !== tabId);
    if (this.pages.length === before) {
      throw new Error(`ConformanceMockContext: no tab "${tabId}"`);
    }
    if (this.activeTabId === tabId) {
      this.activeTabId = this.pages[this.pages.length - 1]?.tabId;
    }
  }

  // -- Wait -----------------------------------------------------------------
  async waitForNavigation(): Promise<void> {}
  async waitForSelector(): Promise<ElementRef> {
    return "e0";
  }
  async waitForIdle(_options?: WaitOptions): Promise<void> {}
}
```

- [ ] **Step 2: Run typecheck.**

Run: `cd packages/test && bun run build:types 2>&1 | tail -15`
Expected: no errors mentioning `ConformanceMockContext.ts`.

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/contract/browser-context/ConformanceMockContext.ts
git commit -m "test(browser-context): add ConformanceMockContext reference impl"
```

---

### Task 2.2: Capability honesty assertion block

**Files:**
- Create: `packages/test/src/contract/browser-context/assertions/capabilityHonesty.ts`
- Modify: `packages/test/src/contract/browser-context/runIBrowserContextConformance.ts`

This block has two halves:

- *Negative:* For every `false` flag, assert `typeof ctx[method] === "undefined"`.
- *Positive:* For every `true` flag, navigate to the fixture page, wait for idle, and assert the optional method returns ≥1 entry containing the fixture marker.

- [ ] **Step 1: Write the assertion file.**

```ts
// packages/test/src/contract/browser-context/assertions/capabilityHonesty.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BrowserContextFixture, IBrowserContextConformanceOpts } from "../types";
import { itExpectFail } from "./itExpectFail";

export function capabilityHonestyBlock(
  opts: IBrowserContextConformanceOpts,
  fixture: BrowserContextFixture
): void {
  describe("Capability honesty", () => {
    const expectFail = (name: string) => opts.expectedFailures?.includes(name) ?? false;

    let ctx: import("@workglow/browser-control/task").IBrowserContext | undefined;
    let handle: Awaited<ReturnType<typeof opts.factory>> | undefined;

    beforeAll(async () => {
      handle = await opts.factory();
      ctx = await handle.create();
    }, opts.timeout);

    afterAll(async () => {
      if (handle && ctx) await handle.dispose(ctx);
    });

    // -- Negative direction -------------------------------------------------

    const runNegative = (
      methodName: "networkRequests" | "consoleMessages",
      assertionName: string
    ) => {
      const body = async () => {
        if (!ctx) throw new Error("context not created");
        // The contract says: when the capability is false, the method must
        // be strictly undefined — NOT a no-op stub returning [].
        expect(typeof (ctx as Record<string, unknown>)[methodName]).toBe("undefined");
      };
      const title = `declares ${methodName}=false → ctx.${methodName} is undefined`;
      if (expectFail(assertionName)) {
        itExpectFail(title, body, opts.timeout);
      } else {
        it(title, body, opts.timeout);
      }
    };

    if (!opts.capabilities.networkRequests) {
      runNegative("networkRequests", "capability.networkRequests.undefinedWhenFalse");
    }
    if (!opts.capabilities.consoleMessages) {
      runNegative("consoleMessages", "capability.consoleMessages.undefinedWhenFalse");
    }

    // -- Positive direction -------------------------------------------------

    if (opts.capabilities.networkRequests) {
      it(
        "declares networkRequests=true → fixture fetch is observable",
        async () => {
          if (!ctx) throw new Error("context not created");
          if (typeof ctx.networkRequests !== "function") {
            throw new Error(
              "capability claims networkRequests=true but ctx.networkRequests is not a function"
            );
          }
          await ctx.navigate(fixture.pageUrl);
          await ctx.waitForIdle({ timeout: 5_000 });
          const entries = await ctx.networkRequests();
          const found = entries.some((r) => r.url.includes(fixture.networkMarkerUrl));
          expect(found, `expected an entry containing ${fixture.networkMarkerUrl}`).toBe(true);
        },
        opts.timeout
      );
    }

    if (opts.capabilities.consoleMessages) {
      it(
        "declares consoleMessages=true → fixture console.log is observable",
        async () => {
          if (!ctx) throw new Error("context not created");
          if (typeof ctx.consoleMessages !== "function") {
            throw new Error(
              "capability claims consoleMessages=true but ctx.consoleMessages is not a function"
            );
          }
          await ctx.navigate(fixture.pageUrl);
          await ctx.waitForIdle({ timeout: 5_000 });
          const entries = await ctx.consoleMessages();
          const found = entries.some((m) => m.text.includes(fixture.consoleMarker));
          expect(found, `expected a console message containing ${fixture.consoleMarker}`).toBe(true);
        },
        opts.timeout
      );
    }
  });
}
```

- [ ] **Step 2: Wire the block into the runner.**

Edit `runIBrowserContextConformance.ts`:

```ts
// packages/test/src/contract/browser-context/runIBrowserContextConformance.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";

import { capabilityHonestyBlock } from "./assertions/capabilityHonesty";
import { resolveFixture } from "./fixtures";
import type { IBrowserContextConformanceOpts } from "./types";

export function runIBrowserContextConformance(opts: IBrowserContextConformanceOpts): void {
  describe.skipIf(opts.skip)(`IBrowserContext conformance: ${opts.name}`, () => {
    const fixture = resolveFixture(opts.fixture);

    capabilityHonestyBlock(opts, fixture);
    // tabsLifecycleBlock, ariaRoundTripBlock, networkIntrospectionBlock
    // are wired in subsequent tasks.
  });
}
```

- [ ] **Step 3: Stub the Mock shim so we can run the new block.**

Create a minimal Mock shim — it will be expanded in Task 2.5 once all blocks land. This step lets each block run end-to-end as it's added.

```ts
// packages/test/src/test/browser/MockBrowser_Generic.test.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConformanceMockContext } from "../../contract/browser-context/ConformanceMockContext";
import { runIBrowserContextConformance } from "../../contract/browser-context/runIBrowserContextConformance";

runIBrowserContextConformance({
  name: "Mock",
  timeout: 5_000,
  factory: async () => ({
    create: async () => {
      const ctx = new ConformanceMockContext();
      await ctx.connect();
      return ctx;
    },
    dispose: async (ctx) => ctx.disconnect(),
  }),
  capabilities: {
    multipleTabs: true,
    networkRequests: false,
    consoleMessages: false,
    ariaSnapshot: true,
  },
});
```

- [ ] **Step 4: Run the Mock shim.**

Run: `cd packages/test && bun run vitest run src/test/browser/MockBrowser_Generic.test.ts 2>&1 | tail -30`
Expected: PASS — `IBrowserContext conformance: Mock > Capability honesty` runs two negative-direction `it`s and they both pass (ConformanceMockContext does not define `networkRequests`/`consoleMessages` properties).

- [ ] **Step 5: Commit.**

```bash
git add packages/test/src/contract/browser-context/assertions/capabilityHonesty.ts \
        packages/test/src/contract/browser-context/runIBrowserContextConformance.ts \
        packages/test/src/test/browser/MockBrowser_Generic.test.ts
git commit -m "test(browser-context): add capability-honesty block + Mock shim"
```

---

### Task 2.3: Tabs lifecycle assertion block

**Files:**
- Create: `packages/test/src/contract/browser-context/assertions/tabsLifecycle.ts`
- Modify: `packages/test/src/contract/browser-context/runIBrowserContextConformance.ts`

Two assertions:
- *Basic lifecycle:* always runs. After connect, `tabs().length ≥ 1`. `newTab(fixtureUrl)` increases length by 1 if `multipleTabs`, else stays at 1. `closeTab(id)` decreases length (single-view backends may disconnect — accept either result).
- *Concurrent close stability:* gated on `multipleTabs`. Open 4 tabs → capture all `tabId`s → `Promise.all([closeTab(A), closeTab(B)])` → for each remaining (C, D) `switchTab(originalTabId)` lands on the right page (verified via `currentUrl()` matching the original).

- [ ] **Step 1: Write the assertion file.**

```ts
// packages/test/src/contract/browser-context/assertions/tabsLifecycle.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IBrowserContext } from "@workglow/browser-control/task";

import type { BrowserContextFixture, IBrowserContextConformanceOpts } from "../types";
import { itExpectFail } from "./itExpectFail";

export function tabsLifecycleBlock(
  opts: IBrowserContextConformanceOpts,
  fixture: BrowserContextFixture
): void {
  describe("Tabs lifecycle", () => {
    const expectFail = (name: string) => opts.expectedFailures?.includes(name) ?? false;

    let ctx: IBrowserContext | undefined;
    let handle: Awaited<ReturnType<typeof opts.factory>> | undefined;

    beforeAll(async () => {
      handle = await opts.factory();
      ctx = await handle.create();
    }, opts.timeout);

    afterAll(async () => {
      if (handle && ctx) await handle.dispose(ctx);
    });

    // -- Basic lifecycle ----------------------------------------------------

    it(
      "tabs() returns at least one tab after connect",
      async () => {
        if (!ctx) throw new Error("context not created");
        const tabs = await ctx.tabs();
        expect(tabs.length).toBeGreaterThanOrEqual(1);
      },
      opts.timeout
    );

    if (opts.capabilities.multipleTabs) {
      it(
        "newTab() increases tab count by 1",
        async () => {
          if (!ctx) throw new Error("context not created");
          const before = (await ctx.tabs()).length;
          await ctx.newTab(fixture.pageUrl);
          const after = (await ctx.tabs()).length;
          expect(after).toBe(before + 1);
        },
        opts.timeout
      );
    }

    // -- Concurrent close stability ----------------------------------------

    if (opts.capabilities.multipleTabs) {
      const title =
        "tabId remains valid for surviving tabs across concurrent close()";
      const body = async () => {
        if (!ctx) throw new Error("context not created");
        // Set up four tabs with distinguishable urls.
        const urls = [
          "data:text/html,<title>A</title>",
          "data:text/html,<title>B</title>",
          "data:text/html,<title>C</title>",
          "data:text/html,<title>D</title>",
        ];
        // Reset to a known state by closing existing non-blank tabs.
        for (const t of await ctx.tabs()) {
          // best-effort cleanup; ignore failures
          try {
            await ctx.closeTab(t.tabId);
          } catch {
            /* noop */
          }
        }
        // Some backends require at least one tab; reconnect if needed.
        if ((await ctx.tabs()).length === 0) {
          await ctx.newTab(urls[0]);
        }
        // Ensure exactly four tabs in our known order.
        const baseTabs = await ctx.tabs();
        const opened: string[] = [];
        for (let i = 0; i < urls.length; i++) {
          if (i < baseTabs.length) {
            // navigate the existing one
            await ctx.switchTab(baseTabs[i].tabId);
            await ctx.navigate(urls[i]);
            opened.push(baseTabs[i].tabId);
          } else {
            const t = await ctx.newTab(urls[i]);
            opened.push(t.tabId);
          }
        }
        const [aId, bId, cId, dId] = opened;
        // Concurrent close.
        await Promise.all([ctx.closeTab(aId), ctx.closeTab(bId)]);
        // Surviving tabs C and D should still resolve to their original urls.
        await ctx.switchTab(cId);
        expect(await ctx.currentUrl()).toBe(urls[2]);
        await ctx.switchTab(dId);
        expect(await ctx.currentUrl()).toBe(urls[3]);
      };
      if (expectFail("tabs.concurrentCloseStable")) {
        itExpectFail(title, body, opts.timeout);
      } else {
        it(title, body, opts.timeout);
      }
    } else {
      // Single-view backends: closeTab(only tabId) must either disconnect
      // OR leave a single tab — accept either result, just don't crash.
      it(
        "single-view: closeTab on the sole tab disconnects or no-ops",
        async () => {
          if (!ctx) throw new Error("context not created");
          const [t] = await ctx.tabs();
          try {
            await ctx.closeTab(t.tabId);
          } catch {
            /* some single-view backends may throw — that is acceptable */
          }
          // Either disconnected or still has at most one tab.
          if (ctx.isConnected()) {
            const after = await ctx.tabs();
            expect(after.length).toBeLessThanOrEqual(1);
          }
        },
        opts.timeout
      );
    }
  });
}
```

- [ ] **Step 2: Wire the block into the runner.**

Edit `runIBrowserContextConformance.ts` — add the import and call:

```ts
import { tabsLifecycleBlock } from "./assertions/tabsLifecycle";
// ...
capabilityHonestyBlock(opts, fixture);
tabsLifecycleBlock(opts, fixture);
```

- [ ] **Step 3: Run the Mock shim — verify both basic and concurrent-close blocks pass.**

Run: `cd packages/test && bun run vitest run src/test/browser/MockBrowser_Generic.test.ts 2>&1 | tail -30`
Expected: PASS — Mock implements stable string tab ids, so the concurrent-close assertion passes.

- [ ] **Step 4: Commit.**

```bash
git add packages/test/src/contract/browser-context/assertions/tabsLifecycle.ts \
        packages/test/src/contract/browser-context/runIBrowserContextConformance.ts
git commit -m "test(browser-context): add tabs lifecycle + concurrent-close stability block"
```

---

### Task 2.4: ARIA round-trip assertion block

**Files:**
- Create: `packages/test/src/contract/browser-context/assertions/ariaRoundTrip.ts`
- Modify: `packages/test/src/contract/browser-context/runIBrowserContextConformance.ts`

Two assertions:
- *Round-trip:* navigate to fixture → snapshot → for each fixture node, `clickByRole("button", name)` → read `data-clicked` attribute on a stored ref to the sentinel and assert it now equals the expected idx.
- *Ref reuse:* a ref captured pre-navigation-of-second-snapshot remains usable for `textContent`.

- [ ] **Step 1: Write the assertion file.**

```ts
// packages/test/src/contract/browser-context/assertions/ariaRoundTrip.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AccessibilityNode, IBrowserContext } from "@workglow/browser-control/task";

import type { BrowserContextFixture, IBrowserContextConformanceOpts } from "../types";
import { itExpectFail } from "./itExpectFail";

function collectButtons(root: AccessibilityNode): AccessibilityNode[] {
  const out: AccessibilityNode[] = [];
  const stack: AccessibilityNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.role === "button") out.push(n);
    if (n.children) stack.push(...n.children);
  }
  return out;
}

export function ariaRoundTripBlock(
  opts: IBrowserContextConformanceOpts,
  fixture: BrowserContextFixture
): void {
  if (!opts.capabilities.ariaSnapshot) return;

  describe("ARIA round-trip", () => {
    const expectFail = (name: string) => opts.expectedFailures?.includes(name) ?? false;

    let ctx: IBrowserContext | undefined;
    let handle: Awaited<ReturnType<typeof opts.factory>> | undefined;

    beforeAll(async () => {
      handle = await opts.factory();
      ctx = await handle.create();
      // Navigate once, all assertions reuse this page.
      await ctx.navigate(fixture.pageUrl);
      await ctx.waitForIdle({ timeout: 5_000 });
    }, opts.timeout);

    afterAll(async () => {
      if (handle && ctx) await handle.dispose(ctx);
    });

    // -- Round-trip per edge-case name -------------------------------------

    for (let i = 0; i < fixture.ariaEdgeCaseNames.length; i++) {
      const name = fixture.ariaEdgeCaseNames[i];
      const isColonName = name.includes(":");
      const title = `clickByRole('button', ${JSON.stringify(name)}) lands on the right node`;
      const body = async () => {
        if (!ctx) throw new Error("context not created");
        // Reset the sentinel by clicking a known no-op first? Just snapshot
        // and grab a sentinel ref instead.
        const tree = await ctx.snapshot();
        const buttons = collectButtons(tree.root);
        const target = buttons.find((b) => b.name === name);
        expect(target, `snapshot must include button with name ${JSON.stringify(name)}`).toBeDefined();

        await ctx.clickByRole("button", name);

        // Read `data-clicked` from the sentinel — locate sentinel by selector.
        const sentinelRef = await ctx.querySelector("#sentinel");
        expect(sentinelRef).not.toBeNull();
        const clicked = await ctx.attribute(sentinelRef!, "data-clicked");
        expect(clicked).toBe(String(i));
      };
      // Names containing a colon trigger the lastIndexOf parser bug in
      // PlaywrightBackend. Adapters with that bug list "aria.colonInName"
      // in expectedFailures; the helper wraps in `it.fails` for them.
      const useExpectFail = isColonName && expectFail("aria.colonInName");
      if (useExpectFail) {
        itExpectFail(title, body, opts.timeout);
      } else {
        it(title, body, opts.timeout);
      }
    }

    // -- Ref reuse after a second snapshot ---------------------------------

    it(
      "refs from snapshot N remain usable for textContent after snapshot N+1",
      async () => {
        if (!ctx) throw new Error("context not created");
        const t1 = await ctx.snapshot();
        const buttons1 = collectButtons(t1.root);
        expect(buttons1.length).toBeGreaterThan(0);
        const ref = buttons1[0].ref;
        // Take a fresh snapshot, then reach back to the older ref.
        await ctx.snapshot();
        const txt = await ctx.textContent(ref);
        expect(txt, "ref from prior snapshot should still resolve").not.toBeNull();
      },
      opts.timeout
    );
  });
}
```

- [ ] **Step 2: Wire into the runner.**

```ts
import { ariaRoundTripBlock } from "./assertions/ariaRoundTrip";
// ...
ariaRoundTripBlock(opts, fixture);
```

- [ ] **Step 3: Run Mock shim.**

Run: `cd packages/test && bun run vitest run src/test/browser/MockBrowser_Generic.test.ts 2>&1 | tail -40`
Expected: PASS — all six edge-case names round-trip; ref-reuse passes.

- [ ] **Step 4: Commit.**

```bash
git add packages/test/src/contract/browser-context/assertions/ariaRoundTrip.ts \
        packages/test/src/contract/browser-context/runIBrowserContextConformance.ts
git commit -m "test(browser-context): add ARIA snapshot round-trip block"
```

---

### Task 2.5: Network introspection assertion block

**Files:**
- Create: `packages/test/src/contract/browser-context/assertions/networkIntrospection.ts`
- Modify: `packages/test/src/contract/browser-context/runIBrowserContextConformance.ts`

This block exists separately from `capabilityHonesty` so the README can document it as the "did the optional method actually capture the fixture's known fetch?" assertion. It only runs when `capabilities.networkRequests` or `capabilities.consoleMessages` is true. (For Mock all four phase-2 shims, both flags are false, so this block is a no-op.)

- [ ] **Step 1: Write the assertion file.**

```ts
// packages/test/src/contract/browser-context/assertions/networkIntrospection.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { IBrowserContext } from "@workglow/browser-control/task";

import type { BrowserContextFixture, IBrowserContextConformanceOpts } from "../types";

export function networkIntrospectionBlock(
  opts: IBrowserContextConformanceOpts,
  fixture: BrowserContextFixture
): void {
  if (!opts.capabilities.networkRequests && !opts.capabilities.consoleMessages) return;

  describe("Network/console introspection", () => {
    let ctx: IBrowserContext | undefined;
    let handle: Awaited<ReturnType<typeof opts.factory>> | undefined;

    beforeAll(async () => {
      handle = await opts.factory();
      ctx = await handle.create();
      await ctx.navigate(fixture.pageUrl);
      await ctx.waitForIdle({ timeout: 5_000 });
    }, opts.timeout);

    afterAll(async () => {
      if (handle && ctx) await handle.dispose(ctx);
    });

    if (opts.capabilities.networkRequests) {
      it(
        "networkRequests() captures the fixture's outbound fetch",
        async () => {
          if (!ctx || typeof ctx.networkRequests !== "function") {
            throw new Error("networkRequests not available despite capability=true");
          }
          const entries = await ctx.networkRequests();
          const found = entries.some((r) => r.url.includes(fixture.networkMarkerUrl));
          expect(found, `expected an entry containing ${fixture.networkMarkerUrl}`).toBe(true);
        },
        opts.timeout
      );

      it(
        "networkRequests({ method }) filters by method",
        async () => {
          if (!ctx || typeof ctx.networkRequests !== "function") {
            throw new Error("networkRequests not available despite capability=true");
          }
          const all = await ctx.networkRequests();
          const gets = await ctx.networkRequests({ method: "GET" });
          // Filter must not return more entries than the unfiltered list.
          expect(gets.length).toBeLessThanOrEqual(all.length);
        },
        opts.timeout
      );
    }

    if (opts.capabilities.consoleMessages) {
      it(
        "consoleMessages() captures the fixture's console.log",
        async () => {
          if (!ctx || typeof ctx.consoleMessages !== "function") {
            throw new Error("consoleMessages not available despite capability=true");
          }
          const entries = await ctx.consoleMessages();
          const found = entries.some((m) => m.text.includes(fixture.consoleMarker));
          expect(found, `expected a console message containing ${fixture.consoleMarker}`).toBe(true);
        },
        opts.timeout
      );
    }
  });
}
```

- [ ] **Step 2: Wire into the runner.**

```ts
import { networkIntrospectionBlock } from "./assertions/networkIntrospection";
// ...
networkIntrospectionBlock(opts, fixture);
```

- [ ] **Step 3: Run Mock shim — block should be skipped (no capabilities flagged).**

Run: `cd packages/test && bun run vitest run src/test/browser/MockBrowser_Generic.test.ts 2>&1 | tail -20`
Expected: PASS — `Network/console introspection` does not appear because `if (!networkRequests && !consoleMessages) return` short-circuits.

- [ ] **Step 4: Commit.**

```bash
git add packages/test/src/contract/browser-context/assertions/networkIntrospection.ts \
        packages/test/src/contract/browser-context/runIBrowserContextConformance.ts
git commit -m "test(browser-context): add network/console introspection block"
```

---

### Task 2.6: Playwright shim with expected failures

**Files:**
- Create: `packages/test/src/test/browser/Playwright_Generic.integration.test.ts`

- [ ] **Step 1: Write the shim.**

```ts
// packages/test/src/test/browser/Playwright_Generic.integration.test.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runIBrowserContextConformance } from "../../contract/browser-context/runIBrowserContextConformance";

let playwrightAvailable = false;
try {
  await import("playwright");
  playwrightAvailable = true;
} catch {
  // playwright not installed
}

runIBrowserContextConformance({
  name: "Playwright",
  skip: !playwrightAvailable,
  timeout: 60_000,
  factory: async () => {
    const { PlaywrightBackend } = await import("@workglow/browser-control/task");
    return {
      create: async () => {
        const ctx = new PlaywrightBackend();
        await ctx.connect({ headless: true });
        return ctx;
      },
      dispose: async (ctx) => {
        await ctx.disconnect();
      },
    };
  },
  capabilities: {
    multipleTabs: true,
    networkRequests: false, // currently a no-op stub returning []; flips after Phase 4
    consoleMessages: false, // currently a no-op stub returning []; flips after Phase 4
    ariaSnapshot: true,
  },
  expectedFailures: [
    // PlaywrightBackend.ts:686-736 — array-index tabId race.
    "tabs.concurrentCloseStable",
    // PlaywrightBackend.ts:419-426 — lastIndexOf(":") parser.
    "aria.colonInName",
    // PlaywrightBackend.ts:768-774 — networkRequests/consoleMessages declared
    // as concrete arrow functions returning []. The negative-direction
    // capability honesty block requires `typeof ctx.networkRequests ===
    // "undefined"` when capabilities.networkRequests is false.
    "capability.networkRequests.undefinedWhenFalse",
    "capability.consoleMessages.undefinedWhenFalse",
  ],
});
```

- [ ] **Step 2: Run the Playwright shim.**

Run: `cd packages/test && bun run vitest run src/test/browser/Playwright_Generic.integration.test.ts 2>&1 | tail -60`
Expected: PASS — assertions outside the four `expectedFailures` succeed; the four named assertions are wrapped in `it.fails` and pass because they correctly throw.

If Playwright is not installed in the local env, the file's top-level `describe.skipIf(!playwrightAvailable)` skips the whole suite — verify the run is reported as `passed | skipped`.

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/test/browser/Playwright_Generic.integration.test.ts
git commit -m "test(browser-context): wire Playwright conformance shim with expected failures"
```

---

## Phase 3 — BunWebView + Electron shims

### Task 3.1: BunWebView shim

**Files:**
- Create: `packages/test/src/test/browser/BunWebView_Generic.integration.test.ts`

BunWebView is a single-view backend (`multipleTabs: false`); the concurrent-close-stability assertion is automatically gated off by the capability flag. Its `networkRequests`/`consoleMessages` empty-array stubs at `BunWebViewBackend.ts:403-409` trip the negative capability honesty assertion — both go in `expectedFailures`.

- [ ] **Step 1: Write the shim.**

```ts
// packages/test/src/test/browser/BunWebView_Generic.integration.test.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { isChromeAvailable } from "./chromeAvailability";
import { runIBrowserContextConformance } from "../../contract/browser-context/runIBrowserContextConformance";

const bunWebViewAvailable =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Boolean((globalThis as { Bun?: { WebView?: unknown } }).Bun?.WebView) && isChromeAvailable();

runIBrowserContextConformance({
  name: "BunWebView",
  skip: !bunWebViewAvailable,
  timeout: 60_000,
  factory: async () => {
    const { BunWebViewBackend } = await import("@workglow/browser-control/task");
    return {
      create: async () => {
        const ctx = new BunWebViewBackend();
        await ctx.connect({ headless: true });
        return ctx;
      },
      dispose: async (ctx) => {
        await ctx.disconnect();
      },
    };
  },
  capabilities: {
    multipleTabs: false, // single-view model
    networkRequests: false,
    consoleMessages: false,
    ariaSnapshot: true,
  },
  expectedFailures: [
    // BunWebViewBackend.ts:403-409 — empty-array stubs.
    "capability.networkRequests.undefinedWhenFalse",
    "capability.consoleMessages.undefinedWhenFalse",
  ],
});
```

- [ ] **Step 2: Run the shim.**

Run: `cd packages/test && bun run vitest run src/test/browser/BunWebView_Generic.integration.test.ts 2>&1 | tail -40`
Expected: PASS or SKIPPED depending on Bun.WebView + Chrome availability. When it runs, all assertions outside the two `expectedFailures` pass; the two named negative-capability assertions are `it.fails` and pass because the empty-array stubs make `typeof === "function"`.

If `data:` URL navigation is restricted in BunWebView, the ARIA + tabs blocks will fail. If observed, narrow the failure set: add a `fixture` override to use an in-process http server. Recorded as a Phase 3 risk in the spec; if hit, document the override in this same shim file.

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/test/browser/BunWebView_Generic.integration.test.ts
git commit -m "test(browser-context): wire BunWebView conformance shim"
```

---

### Task 3.2: Electron shim (skipped without runner)

**Files:**
- Create: `packages/test/src/test/browser/Electron_Generic.integration.test.ts`

- [ ] **Step 1: Write the shim.**

```ts
// packages/test/src/test/browser/Electron_Generic.integration.test.ts
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { runIBrowserContextConformance } from "../../contract/browser-context/runIBrowserContextConformance";

const RUN_ELECTRON = !!process.env.RUN_ELECTRON_TESTS;

runIBrowserContextConformance({
  name: "Electron",
  skip: !RUN_ELECTRON,
  timeout: 60_000,
  factory: async () => {
    const { ElectronBackend } = await import("@workglow/browser-control/task");
    return {
      create: async () => {
        const ctx = new ElectronBackend();
        await ctx.connect({ headless: true });
        return ctx;
      },
      dispose: async (ctx) => {
        await ctx.disconnect();
      },
    };
  },
  capabilities: {
    multipleTabs: true,
    networkRequests: false,
    consoleMessages: false,
    ariaSnapshot: true,
  },
  // Electron extends CDPBrowserBackend. The CDP base does not currently
  // declare networkRequests/consoleMessages stubs (per
  // CDPBrowserBackend.ts), so those negative assertions are NOT
  // expected to fail. Add them only if observed during a real run.
  expectedFailures: [],
});
```

Note: Electron's `expectedFailures` list is empty by default. If the suite is run under `RUN_ELECTRON_TESTS=1` and reveals ElectronBackend-specific drift, populate the list at that time.

- [ ] **Step 2: Quick sanity run (suite skips without env var).**

Run: `cd packages/test && bun run vitest run src/test/browser/Electron_Generic.integration.test.ts 2>&1 | tail -15`
Expected: SKIPPED (no `RUN_ELECTRON_TESTS` set).

- [ ] **Step 3: Commit.**

```bash
git add packages/test/src/test/browser/Electron_Generic.integration.test.ts
git commit -m "test(browser-context): wire Electron conformance shim (skipped by default)"
```

---

### Task 3.3: Full suite run + CI cost confirmation

- [ ] **Step 1: Run all four browser-context conformance shims.**

Run: `cd packages/test && bun run vitest run --reporter=verbose 'src/test/browser/*_Generic*' 2>&1 | tail -80`
Expected: PASS for each shim available locally; SKIPPED for shims whose runtime is missing. Report total wall time.

- [ ] **Step 2: Confirm CI cost ≤ ~30 s on the Playwright job.**

The relevant CI job is whichever step runs `bun run test:vitest` against `packages/test`. The new `Playwright_Generic.integration.test.ts` adds capability + tabs + ARIA + (skipped) network introspection blocks against a real Playwright browser. Compare wall time against a pre-task baseline. If runtime increase exceeds 30 s, mark a follow-up to either reduce edge-case-name iterations or share a Playwright browser across blocks (the existing `PlaywrightBrowser.integration.test.ts` already shares a browser; the conformance shim could be refactored to do the same in a follow-up).

No commit — this is a verification step. If a follow-up is needed, add it to the spec's "Open questions" list.

---

## Phase 4 — Fix the three known IBrowserContext bugs

Each fix lands in its own commit. After each fix, drop the corresponding entry from `expectedFailures` in the relevant shim, run the suite, and verify the test now passes as a regular `it`.

### Task 4.1: Delete empty-stub `networkRequests` / `consoleMessages` properties

**Files:**
- Modify: `packages/browser-control/src/task/PlaywrightBackend.ts:765-775`
- Modify: `packages/browser-control/src/task/BunWebViewBackend.ts:399-410`
- Modify: `packages/test/src/test/browser/Playwright_Generic.integration.test.ts`
- Modify: `packages/test/src/test/browser/BunWebView_Generic.integration.test.ts`

The contract: optional methods are either fully implemented OR `undefined`. Since neither backend implements them, declare `undefined` by deleting the property.

- [ ] **Step 1: Run the conformance suite to confirm the failing baseline.**

Run: `cd packages/test && bun run vitest run 'src/test/browser/Playwright_Generic*' 'src/test/browser/BunWebView_Generic*' 2>&1 | tail -20`
Expected: the two `capability.*.undefinedWhenFalse` assertions in each shim are listed under `[expected-fail]` and pass because they correctly throw.

- [ ] **Step 2: Delete the properties from PlaywrightBackend.**

Find the block at the bottom of `packages/browser-control/src/task/PlaywrightBackend.ts`:

```ts
  // ---------------------------------------------------------------------------
  // Optional capabilities (simplified)
  // ---------------------------------------------------------------------------

  readonly networkRequests = (_filter?: NetworkFilter): Promise<readonly NetworkRequest[]> => {
    return Promise.resolve([]);
  };

  readonly consoleMessages = (): Promise<readonly ConsoleMessage[]> => {
    return Promise.resolve([]);
  };
}
```

Replace with:

```ts
  // ---------------------------------------------------------------------------
  // Optional capabilities
  // ---------------------------------------------------------------------------
  //
  // networkRequests and consoleMessages are intentionally undefined: this
  // backend does not implement them. The IBrowserContext contract is that
  // optional methods are either fully implemented or undefined — never
  // empty-stub functions that defeat feature detection.
}
```

Drop now-unused imports: remove `NetworkFilter`, `NetworkRequest`, `ConsoleMessage` from the import list at the top of the file if (and only if) they are no longer referenced anywhere else in the file.

- [ ] **Step 3: Delete the properties from BunWebViewBackend identically.**

Find the block at the bottom of `packages/browser-control/src/task/BunWebViewBackend.ts`:

```ts
  // ---------------------------------------------------------------------------
  // Optional capabilities (stubs)
  // ---------------------------------------------------------------------------

  readonly networkRequests = (_filter?: NetworkFilter): Promise<readonly NetworkRequest[]> => {
    return Promise.resolve([]);
  };

  readonly consoleMessages = (): Promise<readonly ConsoleMessage[]> => {
    return Promise.resolve([]);
  };
```

Replace with the same comment. Drop now-unused imports if applicable.

- [ ] **Step 4: Drop the corresponding `expectedFailures` entries from both shims.**

In `Playwright_Generic.integration.test.ts`, change:

```ts
  expectedFailures: [
    "tabs.concurrentCloseStable",
    "aria.colonInName",
    "capability.networkRequests.undefinedWhenFalse",
    "capability.consoleMessages.undefinedWhenFalse",
  ],
```

to:

```ts
  expectedFailures: [
    "tabs.concurrentCloseStable",
    "aria.colonInName",
  ],
```

In `BunWebView_Generic.integration.test.ts`, change:

```ts
  expectedFailures: [
    "capability.networkRequests.undefinedWhenFalse",
    "capability.consoleMessages.undefinedWhenFalse",
  ],
```

to:

```ts
  expectedFailures: [],
```

- [ ] **Step 5: Run typecheck + suites.**

Run: `cd packages/browser-control && bun run build:types 2>&1 | tail -10`
Expected: no errors. If "unused import" surfaces for `NetworkFilter` etc., remove the imports from the top of the relevant backend file.

Run: `cd packages/test && bun run vitest run 'src/test/browser/Playwright_Generic*' 'src/test/browser/BunWebView_Generic*' 2>&1 | tail -30`
Expected: PASS — the previously-expected failures now pass as regular `it`s. No `[expected-fail]` lines for capability assertions.

Also re-run the existing Tasks-layer tests to make sure nothing else relied on the stubs:

Run: `cd packages/test && bun run vitest run 'src/test/browser/PlaywrightBrowser*' 'src/test/browser/BunWebViewBrowser*' 'src/test/browser/MockBrowser*' 2>&1 | tail -30`
Expected: PASS — `genericBrowserTaskTests.ts` consumes the public IBrowserContext surface, not these properties; deleting them should be a no-op for it.

- [ ] **Step 6: Commit.**

```bash
git add packages/browser-control/src/task/PlaywrightBackend.ts \
        packages/browser-control/src/task/BunWebViewBackend.ts \
        packages/test/src/test/browser/Playwright_Generic.integration.test.ts \
        packages/test/src/test/browser/BunWebView_Generic.integration.test.ts
git commit -m "fix(browser-control): remove empty-stub networkRequests/consoleMessages properties

Optional methods on IBrowserContext are either fully implemented or
undefined — never empty-stub functions that defeat feature detection.
Neither PlaywrightBackend nor BunWebViewBackend implements these, so
delete the properties to declare 'not supported'."
```

---

### Task 4.2: Replace array-index tabIds with stable string ids in PlaywrightBackend

**Files:**
- Modify: `packages/browser-control/src/task/PlaywrightBackend.ts:686-736` (`tabs`, `switchTab`, `newTab`, `closeTab`)
- Modify: `packages/test/src/test/browser/Playwright_Generic.integration.test.ts`

Replace `parseInt(tabId)` array-index lookups with a stable per-page ID generator. New tabs get an opaque string id (e.g. `"t1"`, `"t2"`); closing a tab does not invalidate other ids.

- [ ] **Step 1: Confirm failing baseline.**

Run: `cd packages/test && bun run vitest run 'src/test/browser/Playwright_Generic*' --reporter=verbose 2>&1 | grep -i "concurrent\|expected-fail" | head -10`
Expected: at least one line referencing `tabs.concurrentCloseStable [expected-fail]`.

- [ ] **Step 2: Add a per-context tab-id map.**

In `PlaywrightBackend.ts`, locate the field declarations near line 240. Add:

```ts
  // Stable per-page tab ids. Surviving across concurrent close.
  private _pageIds: WeakMap<AnyPage, string> = new WeakMap();
  private _pageIdSeq = 0;
  private idForPage(page: AnyPage): string {
    let id = this._pageIds.get(page);
    if (!id) {
      id = `t${++this._pageIdSeq}`;
      this._pageIds.set(page, id);
    }
    return id;
  }
```

Note the field type uses `AnyPage` — keep it consistent with the surrounding code (the file already uses `AnyPage` as a type alias for Playwright's Page; see imports at the top of the file).

- [ ] **Step 3: Rewrite the four tab methods to use stable ids.**

Replace lines 686-736:

```ts
  async tabs(): Promise<readonly TabInfo[]> {
    const pages: AnyPage[] = this.context.pages();
    return Promise.all(
      pages.map(async (p: AnyPage) => ({
        tabId: this.idForPage(p),
        url: p.url(),
        title: await p.title(),
      }))
    );
  }

  async switchTab(tabId: string): Promise<void> {
    const pages: AnyPage[] = this.context.pages();
    const target = pages.find((p) => this._pageIds.get(p) === tabId);
    if (!target) {
      throw new Error(`PlaywrightBackend: no tab with id "${tabId}"`);
    }
    this._page = target;
    await target.bringToFront();
  }

  async newTab(url?: string): Promise<TabInfo> {
    const newPage: AnyPage = await this.context.newPage();
    if (url) {
      await newPage.goto(url, { waitUntil: "load" });
    }
    return {
      tabId: this.idForPage(newPage),
      url: newPage.url(),
      title: await newPage.title(),
    };
  }

  async closeTab(tabId: string): Promise<void> {
    const pages: AnyPage[] = this.context.pages();
    const target = pages.find((p) => this._pageIds.get(p) === tabId);
    if (!target) {
      throw new Error(`PlaywrightBackend: no tab with id "${tabId}"`);
    }
    await target.close();

    // If we closed the active page, switch to the last remaining page
    if (this._page === target) {
      const remaining: AnyPage[] = this.context.pages();
      this._page = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  }
```

- [ ] **Step 4: Drop `tabs.concurrentCloseStable` from the Playwright shim's `expectedFailures`.**

```ts
  expectedFailures: [
    "aria.colonInName",
  ],
```

- [ ] **Step 5: Run typecheck + suite.**

Run: `cd packages/browser-control && bun run build:types 2>&1 | tail -10`
Expected: no errors.

Run: `cd packages/test && bun run vitest run 'src/test/browser/Playwright_Generic*' --reporter=verbose 2>&1 | tail -30`
Expected: `tabId remains valid for surviving tabs across concurrent close()` passes as a regular `it`.

Also run the existing Tasks-layer Playwright integration test to be sure its tab-related assertions still work:

Run: `cd packages/test && bun run vitest run 'src/test/browser/PlaywrightBrowser*' 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/browser-control/src/task/PlaywrightBackend.ts \
        packages/test/src/test/browser/Playwright_Generic.integration.test.ts
git commit -m "fix(browser-control): stable tabIds in PlaywrightBackend

tabs() returned tabId: String(idx) derived from pages.indexOf(...);
switchTab/closeTab re-looked-up by parseInt. Closing tab 0 shifted
every subsequent tabId, breaking stored references after concurrent
close. Replace with WeakMap<Page, string> + per-context counter so
ids are stable across the page's lifetime."
```

---

### Task 4.3: Replace string-descriptor refMap with structured records

**Files:**
- Modify: `packages/browser-control/src/task/PlaywrightBackend.ts` (`_refMap`, `buildLocatorString`, `descriptorToLocator`, `resolveRef`, and every site that reads/writes `_refMap`)
- Modify: `packages/test/src/test/browser/Playwright_Generic.integration.test.ts`

The existing string-encoded descriptor format (`"getByRole:button:Sign In"`, `"nth:<inner>:<idx>"`) cannot disambiguate ARIA names containing colons from the nth-suffix. Replace with structured records.

- [ ] **Step 1: Confirm failing baseline.**

Run: `cd packages/test && bun run vitest run 'src/test/browser/Playwright_Generic*' --reporter=verbose 2>&1 | grep -i "colon\|expected-fail" | head -10`
Expected: lines referencing `aria.colonInName [expected-fail]` for at least the `"foo:bar"` and `"11:30"` edge cases.

- [ ] **Step 2: Define a `Descriptor` discriminated union near the top of `PlaywrightBackend.ts` (above the class declaration).**

```ts
type Descriptor =
  | { readonly kind: "role"; readonly role: string; readonly name: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "css"; readonly selector: string }
  | { readonly kind: "nth"; readonly inner: Descriptor; readonly index: number };
```

- [ ] **Step 3: Change the `_refMap` field type and remove the string parser.**

Locate the field at line ~247:

```ts
  private _refMap = new Map<string, string>();
```

Change to:

```ts
  private _refMap = new Map<string, Descriptor>();
```

- [ ] **Step 4: Replace `buildLocatorString` (around line 215) with a builder that returns a `Descriptor`.**

```ts
function buildDescriptor(role: string, name: string): Descriptor {
  if (role === "text" || role === "StaticText") {
    return { kind: "text", text: name };
  }
  return { kind: "role", role, name };
}
```

Update every call site of the old `buildLocatorString` to call `buildDescriptor` and store the descriptor (no more string-formatting).

- [ ] **Step 5: Replace `descriptorToLocator` and `resolveRef`.**

```ts
  private resolveRef(ref: ElementRef): AnyLocator {
    const descriptor = this._refMap.get(ref);
    if (!descriptor) {
      throw new Error(`PlaywrightBackend: unknown ref "${ref}"`);
    }
    return this.descriptorToLocator(descriptor);
  }

  private descriptorToLocator(descriptor: Descriptor): AnyLocator {
    const page = this.page;
    switch (descriptor.kind) {
      case "role":
        return descriptor.name
          ? page.getByRole(descriptor.role, { name: descriptor.name })
          : page.getByRole(descriptor.role);
      case "text":
        return page.getByText(descriptor.text);
      case "css":
        return page.locator(descriptor.selector);
      case "nth":
        return this.descriptorToLocator(descriptor.inner).nth(descriptor.index);
    }
  }
```

- [ ] **Step 6: Update every `_refMap.set(ref, "css:...")` etc. to set a structured record.**

Search the file for `_refMap.set(`:

```bash
grep -n "_refMap.set" packages/browser-control/src/task/PlaywrightBackend.ts
```

For each match, rewrite the second argument from a string descriptor to the equivalent `Descriptor` record. Common patterns:

| Old string | New record |
|---|---|
| `` `css:${selector}` `` | `{ kind: "css", selector }` |
| `` `getByRole:${role}:${name}` `` | `buildDescriptor(role, name)` |
| `` `getByText:${text}` `` | `{ kind: "text", text }` |
| `` `nth:${inner}:${idx}` `` (rare/unused — verify) | `{ kind: "nth", inner: <descriptor>, index: idx }` |

- [ ] **Step 7: Drop `aria.colonInName` from the Playwright shim's `expectedFailures`.**

```ts
  expectedFailures: [],
```

- [ ] **Step 8: Run typecheck + suites.**

Run: `cd packages/browser-control && bun run build:types 2>&1 | tail -10`
Expected: no errors. If TypeScript flags `Descriptor` not exhaustive in a `switch`, add the missing case.

Run: `cd packages/test && bun run vitest run 'src/test/browser/Playwright_Generic*' 'src/test/browser/PlaywrightBrowser*' --reporter=verbose 2>&1 | tail -50`
Expected: all colon-name ARIA round-trip assertions pass; existing Playwright tasks tests still pass.

- [ ] **Step 9: Commit.**

```bash
git add packages/browser-control/src/task/PlaywrightBackend.ts \
        packages/test/src/test/browser/Playwright_Generic.integration.test.ts
git commit -m "fix(browser-control): structured refMap descriptors in PlaywrightBackend

Old string format 'nth:<inner>:<idx>' used lastIndexOf(':') to split
the trailing index, mis-parsing ARIA names ending in :<digits> (e.g.
'11:30' with nth:5 → inner='getByRole:textbox:11:30', index=5 instead
of inner='getByRole:textbox:11:30:5', index=undefined).

Replace ad-hoc string descriptors with a discriminated union stored
directly in _refMap. Eliminates string parsing, supports any ARIA name
including those containing colons."
```

---

## Self-review checklist (run after writing all tasks)

These items are spec requirements; verify each maps to a task above.

| Spec section | Tasks covering it |
|---|---|
| Architecture / file layout | Task 1.1, 1.2, 1.3, 2.1, 2.2-2.5 |
| `runIBrowserContextConformance` API | Task 1.1 (types), 1.3 (runner), 2.2-2.5 (blocks) |
| Capability honesty (negative) | Task 2.2 |
| Capability honesty (positive) | Task 2.2, 2.5 |
| Tabs basic lifecycle | Task 2.3 |
| Tabs concurrent-close stability | Task 2.3 |
| ARIA round-trip | Task 2.4 |
| ARIA ref reuse | Task 2.4 |
| Network introspection | Task 2.5 |
| Mock shim | Task 2.1, 2.2 |
| Playwright shim | Task 2.6 |
| BunWebView shim | Task 3.1 |
| Electron shim | Task 3.2 |
| Phase 4: empty-stub fix | Task 4.1 |
| Phase 4: tabId race fix | Task 4.2 |
| Phase 4: descriptor parser fix | Task 4.3 |
| README factory-shape variants | Task 1.3 |
| README "Available suites" row | Task 1.3 |
| CI cost confirmation | Task 3.3 |
