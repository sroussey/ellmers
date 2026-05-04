/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
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
} from "./IBrowserContext";

// ---------------------------------------------------------------------------
// Playwright types (not imported at module level — lazy optional dependency)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLocator = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBrowserContext = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBrowser = any;

// ---------------------------------------------------------------------------
// Lazy Playwright loader
// ---------------------------------------------------------------------------

let playwrightModule: typeof import("playwright");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPlaywright(): Promise<Record<string, any>> {
  if (!playwrightModule) {
    playwrightModule = await import("playwright");
  }
  return playwrightModule;
}

// ---------------------------------------------------------------------------
// ARIA snapshot parser
// ---------------------------------------------------------------------------

/**
 * Parse a single ARIA snapshot line.
 * Format examples:
 *   - button "Sign In"
 *   - heading "Welcome" [level=1]
 *   - textbox "Email"
 *   - navigation "Main":
 *   - list:
 */
interface ParsedAriaLine {
  indent: number;
  role: string;
  name: string;
  attrs: Record<string, string>;
  hasChildren: boolean;
}

function parseAriaLine(line: string): ParsedAriaLine | null {
  // Count leading spaces for indentation (2 spaces per level after the "- ")
  const match = line.match(/^(\s*)-\s+(.*)$/);
  if (!match) return null;

  const indent = match[1].length;
  let rest = match[2].trim();

  // Check if this node has children (trailing colon)
  const hasChildren = rest.endsWith(":");
  if (hasChildren) rest = rest.slice(0, -1).trim();

  // Extract attributes like [level=1] [checked=true]
  const attrs: Record<string, string> = {};
  rest = rest
    .replace(/\[([^\]]+)\]/g, (_m, attr: string) => {
      const eqIdx = attr.indexOf("=");
      if (eqIdx !== -1) {
        attrs[attr.slice(0, eqIdx).trim()] = attr.slice(eqIdx + 1).trim();
      } else {
        attrs[attr.trim()] = "true";
      }
      return "";
    })
    .trim();

  // Extract role and optional quoted name
  // e.g. `button "Sign In"` or `list` or `heading "Welcome"`
  const roleNameMatch = rest.match(/^(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?/);
  if (!roleNameMatch) return null;

  const role = roleNameMatch[1];
  const name = roleNameMatch[2] !== undefined ? roleNameMatch[2].replace(/\\"/g, '"') : "";

  return { indent, role, name, attrs, hasChildren };
}

interface MutableAccessibilityNode {
  ref: ElementRef;
  role: AriaRole;
  name: string;
  level?: number;
  checked?: boolean | "mixed";
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean | "mixed";
  selected?: boolean;
  value?: string | number;
  children?: MutableAccessibilityNode[];
}

function parseAriaYaml(
  yaml: string,
  refCounter: { count: number },
  refMap: Map<string, string>
): AccessibilityNode {
  const lines = yaml.split("\n");

  // Stack of {node, indent} for building the tree
  const stack: Array<{ node: MutableAccessibilityNode; indent: number }> = [];
  let root: MutableAccessibilityNode | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const parsed = parseAriaLine(line);
    if (!parsed) continue;

    const ref = `e${++refCounter.count}`;

    // Build locator string for this node
    const locatorStr = buildLocatorString(parsed.role, parsed.name);
    refMap.set(ref, locatorStr);

    const node: MutableAccessibilityNode = {
      ref,
      role: parsed.role as AriaRole,
      name: parsed.name,
    };

    // Apply attributes
    if (parsed.attrs.level !== undefined) {
      node.level = parseInt(parsed.attrs.level, 10);
    }
    if (parsed.attrs.checked !== undefined) {
      node.checked = parsed.attrs.checked === "mixed" ? "mixed" : parsed.attrs.checked === "true";
    }
    if (parsed.attrs.disabled !== undefined) {
      node.disabled = parsed.attrs.disabled === "true";
    }
    if (parsed.attrs.expanded !== undefined) {
      node.expanded = parsed.attrs.expanded === "true";
    }
    if (parsed.attrs.pressed !== undefined) {
      node.pressed = parsed.attrs.pressed === "mixed" ? "mixed" : parsed.attrs.pressed === "true";
    }
    if (parsed.attrs.selected !== undefined) {
      node.selected = parsed.attrs.selected === "true";
    }
    if (parsed.attrs.value !== undefined) {
      const numVal = Number(parsed.attrs.value);
      node.value = isNaN(numVal) ? parsed.attrs.value : numVal;
    }

    if (parsed.hasChildren) {
      node.children = [];
    }

    // Pop stack elements that are at the same or deeper indentation
    while (stack.length > 0 && stack[stack.length - 1].indent >= parsed.indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      root = node;
    } else {
      const parent = stack[stack.length - 1].node;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }

    stack.push({ node, indent: parsed.indent });
  }

  if (!root) {
    // Return a synthetic root if parsing fails
    const ref = `e${++refCounter.count}`;
    refMap.set(ref, 'locator("body")');
    return { ref, role: "document", name: "" };
  }

  return root as AccessibilityNode;
}

/**
 * Build a Playwright locator descriptor string from ARIA role/name.
 * These strings are stored in the refMap and interpreted by resolveRef().
 */
function buildLocatorString(role: string, name: string): string {
  // Roles that are typically text nodes — check before the generic name check
  if (role === "text" || role === "StaticText") {
    return `getByText:${name}`;
  }
  if (name) {
    return `getByRole:${role}:${name}`;
  }
  return `getByRole:${role}:`;
}

// ---------------------------------------------------------------------------
// PlaywrightBackend
// ---------------------------------------------------------------------------

export class PlaywrightBackend implements IBrowserContext {
  /**
   * When set, `connect()` reuses this browser for local mode instead of launching a new process.
   * Used by integration tests to avoid per-test launch/teardown flakiness. The caller must not
   * close the browser until all backends that reference it have disconnected.
   */
  constructor(private readonly sharedLocalBrowser?: AnyBrowser) {}

  // Internal Playwright state
  private _browser: AnyBrowser | null = null;
  private _context: AnyBrowserContext | null = null;
  private _page: AnyPage | null = null;
  private _connected = false;
  /** True when this backend launched Chromium locally (owns full process tree). */
  private _launchedLocalChromium = false;

  // Ref management
  private _refMap = new Map<string, string>();
  private _refCounter = { count: 0 };

  // Dialog handler
  private _dialogHandler: ((info: DialogInfo) => DialogAction | Promise<DialogAction>) | null =
    null;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async connect(options: BrowserConnectOptions = {}): Promise<void> {
    const pw = await getPlaywright();
    const { headless = true, cdpUrl, backend = "local" } = options;

    if (backend === "cloud" || cdpUrl) {
      // Cloud / CDP mode
      if (this.sharedLocalBrowser) {
        throw new Error(
          "PlaywrightBackend: sharedLocalBrowser is only supported for local backend"
        );
      }
      this._launchedLocalChromium = false;
      if (!cdpUrl) {
        throw new Error("PlaywrightBackend: cdpUrl is required for cloud backend");
      }
      this._browser = await pw.chromium.connectOverCDP(cdpUrl);
      const contexts: AnyBrowserContext[] = this._browser.contexts();
      this._context = contexts.length > 0 ? contexts[0] : await this._browser.newContext();
      const pages: AnyPage[] = this._context.pages();
      this._page = pages.length > 0 ? pages[0] : await this._context.newPage();
    } else {
      // Local mode
      if (this.sharedLocalBrowser) {
        this._browser = this.sharedLocalBrowser;
        this._launchedLocalChromium = false;
      } else {
        this._launchedLocalChromium = true;
        this._browser = await pw.chromium.launch({
          headless,
          // Reduces hangs / crashes when /dev/shm is small (common in containers).
          args: ["--disable-dev-shm-usage"],
        });
      }
      this._context = await this._browser.newContext();
      this._page = await this._context.newPage();
    }

    // Wire dialog handler
    this._page.on("dialog", async (dialog: AnyPage) => {
      const info: DialogInfo = {
        type: dialog.type() as DialogInfo["type"],
        message: dialog.message(),
        defaultValue: dialog.defaultValue() ?? undefined,
      };
      if (this._dialogHandler) {
        const action = await this._dialogHandler(info);
        if (action.accept) {
          await dialog.accept(
            "promptText" in action
              ? (action as { accept: true; promptText?: string }).promptText
              : undefined
          );
        } else {
          await dialog.dismiss();
        }
      } else {
        // Default: auto-dismiss
        await dialog.dismiss();
      }
    });

    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    const page = this._page;
    const context = this._context;
    const browser = this._browser;
    const launchedLocal = this._launchedLocalChromium;
    const sharedLocal = this.sharedLocalBrowser !== undefined;
    this._page = null;
    this._context = null;
    this._browser = null;
    this._launchedLocalChromium = false;

    try {
      if (launchedLocal || sharedLocal) {
        // Tear down in reverse order so the browser process does not stall waiting on pages.
        if (page) {
          try {
            await page.close({ runBeforeUnload: false });
          } catch {
            // ignore
          }
        }
        if (context) {
          try {
            await context.close();
          } catch {
            // ignore
          }
        }
      }
      if (browser && !sharedLocal) {
        await browser.close();
      }
    } finally {
      this._refMap.clear();
      this._refCounter.count = 0;
    }
  }

  isConnected(): boolean {
    return this._connected;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private get page(): AnyPage {
    if (!this._page) throw new Error("PlaywrightBackend: not connected — call connect() first");
    return this._page;
  }

  private get context(): AnyBrowserContext {
    if (!this._context) throw new Error("PlaywrightBackend: not connected — call connect() first");
    return this._context;
  }

  /**
   * Resolve an ElementRef to a Playwright Locator.
   * The refMap stores descriptor strings like:
   *   "getByRole:button:Sign In"
   *   "getByText:some text"
   *   "css:.my-class"
   *   "nth:getByRole:listitem::2"
   */
  private resolveRef(ref: ElementRef): AnyLocator {
    const descriptor = this._refMap.get(ref);
    if (!descriptor) {
      throw new Error(`PlaywrightBackend: unknown ref "${ref}"`);
    }
    return this.descriptorToLocator(descriptor);
  }

  private descriptorToLocator(descriptor: string): AnyLocator {
    const page = this.page;

    if (descriptor.startsWith("getByRole:")) {
      const rest = descriptor.slice("getByRole:".length);
      const colonIdx = rest.indexOf(":");
      const role = rest.slice(0, colonIdx);
      const name = rest.slice(colonIdx + 1);
      if (name) {
        return page.getByRole(role, { name });
      }
      return page.getByRole(role);
    }

    if (descriptor.startsWith("getByText:")) {
      const text = descriptor.slice("getByText:".length);
      return page.getByText(text);
    }

    if (descriptor.startsWith("css:")) {
      const selector = descriptor.slice("css:".length);
      return page.locator(selector);
    }

    if (descriptor.startsWith("nth:")) {
      // Format: "nth:<inner-descriptor>:<index>"
      // We need to split off the trailing ":<number>"
      const withoutPrefix = descriptor.slice("nth:".length);
      const lastColon = withoutPrefix.lastIndexOf(":");
      const inner = withoutPrefix.slice(0, lastColon);
      const idx = parseInt(withoutPrefix.slice(lastColon + 1), 10);
      return this.descriptorToLocator(inner).nth(idx);
    }

    // Fallback: treat as CSS selector
    return page.locator(descriptor);
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async navigate(url: string, options: NavigateOptions = {}): Promise<void> {
    const { waitUntil = "load", timeout = 30_000 } = options;
    await this.page.goto(url, { waitUntil, timeout });
  }

  async goBack(options: NavigateOptions = {}): Promise<void> {
    const { waitUntil = "load", timeout = 30_000 } = options;
    await this.page.goBack({ waitUntil, timeout });
  }

  async goForward(options: NavigateOptions = {}): Promise<void> {
    const { waitUntil = "load", timeout = 30_000 } = options;
    await this.page.goForward({ waitUntil, timeout });
  }

  async reload(options: NavigateOptions = {}): Promise<void> {
    const { waitUntil = "load", timeout = 30_000 } = options;
    await this.page.reload({ waitUntil, timeout });
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  // ---------------------------------------------------------------------------
  // Accessibility
  // ---------------------------------------------------------------------------

  async snapshot(options: SnapshotOptions = {}): Promise<AccessibilityTree> {
    let locator: AnyLocator;

    if (options.ref) {
      locator = this.resolveRef(options.ref);
    } else {
      locator = this.page.locator("body");
    }

    const yaml: string = await locator.ariaSnapshot();

    // Reset refs so snapshot refs are stable within a session
    // (we keep the monotonic counter to avoid collisions with querySelector refs)
    const root = parseAriaYaml(yaml, this._refCounter, this._refMap);

    return { root, yaml };
  }

  // ---------------------------------------------------------------------------
  // Element interaction (by ref)
  // ---------------------------------------------------------------------------

  async click(ref: ElementRef, options: ClickOptions = {}): Promise<void> {
    const locator = this.resolveRef(ref);
    const { modifiers, button, clickCount, timeout } = options;
    await locator.click({
      ...(modifiers !== undefined ? { modifiers } : {}),
      ...(button !== undefined ? { button } : {}),
      ...(clickCount !== undefined ? { clickCount } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    });
  }

  async fill(ref: ElementRef, value: string, options: WaitOptions = {}): Promise<void> {
    const locator = this.resolveRef(ref);
    const { timeout } = options;
    await locator.fill(value, ...(timeout !== undefined ? [{ timeout }] : []));
  }

  async selectOption(
    ref: ElementRef,
    values: string | readonly string[],
    options: WaitOptions = {}
  ): Promise<void> {
    const locator = this.resolveRef(ref);
    const { timeout } = options;
    await locator.selectOption(values, ...(timeout !== undefined ? [{ timeout }] : []));
  }

  async hover(ref: ElementRef, options: WaitOptions = {}): Promise<void> {
    const locator = this.resolveRef(ref);
    const { timeout } = options;
    await locator.hover(...(timeout !== undefined ? [{ timeout }] : []));
  }

  // ---------------------------------------------------------------------------
  // Semantic interaction
  // ---------------------------------------------------------------------------

  async clickByRole(role: AriaRole, name: string, options: ClickOptions = {}): Promise<void> {
    const { modifiers, button, clickCount, timeout } = options;
    await this.page.getByRole(role, { name }).click({
      ...(modifiers !== undefined ? { modifiers } : {}),
      ...(button !== undefined ? { button } : {}),
      ...(clickCount !== undefined ? { clickCount } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    });
  }

  async fillByLabel(label: string, value: string, options: WaitOptions = {}): Promise<void> {
    const { timeout } = options;
    await this.page.getByLabel(label).fill(value, ...(timeout !== undefined ? [{ timeout }] : []));
  }

  // ---------------------------------------------------------------------------
  // Content extraction
  // ---------------------------------------------------------------------------

  async content(): Promise<string> {
    return this.page.content();
  }

  async innerHTML(ref: ElementRef): Promise<string> {
    const locator = this.resolveRef(ref);
    return locator.innerHTML();
  }

  async textContent(ref: ElementRef): Promise<string | null> {
    const locator = this.resolveRef(ref);
    return locator.textContent();
  }

  async attribute(ref: ElementRef, name: string): Promise<string | null> {
    const locator = this.resolveRef(ref);
    return locator.getAttribute(name);
  }

  // ---------------------------------------------------------------------------
  // CSS selectors
  // ---------------------------------------------------------------------------

  async querySelector(selector: string): Promise<ElementRef | null> {
    const locator = this.page.locator(selector);
    const count: number = await locator.count();
    if (count === 0) return null;

    const ref = `e${++this._refCounter.count}`;
    this._refMap.set(ref, `css:${selector}`);
    return ref;
  }

  async querySelectorAll(selector: string): Promise<readonly ElementRef[]> {
    const locator = this.page.locator(selector);
    const count: number = await locator.count();
    const refs: ElementRef[] = [];

    for (let i = 0; i < count; i++) {
      const ref = `e${++this._refCounter.count}`;
      this._refMap.set(ref, `nth:css:${selector}:${i}`);
      refs.push(ref);
    }

    return refs;
  }

  // ---------------------------------------------------------------------------
  // JS evaluation
  // ---------------------------------------------------------------------------

  async evaluate<T>(expression: string): Promise<T> {
    return this.page.evaluate(expression) as Promise<T>;
  }

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    const { format = "png", quality, fullPage = false } = options;
    const screenshotOptions: Record<string, unknown> = {
      type: format,
      fullPage,
    };
    if (format === "jpeg" && quality !== undefined) {
      screenshotOptions.quality = quality;
    }
    return this.page.screenshot(screenshotOptions) as Promise<Buffer>;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  async pressKey(key: string, _options: WaitOptions = {}): Promise<void> {
    await this.page.keyboard.press(key);
  }

  async type(text: string, _options: WaitOptions = {}): Promise<void> {
    await this.page.keyboard.type(text);
  }

  async scroll(x: number, y: number, ref?: ElementRef): Promise<void> {
    if (ref) {
      // Scroll within element using JavaScript
      const locator = this.resolveRef(ref);
      await locator.evaluate(
        (el: Element, args: { x: number; y: number }) => {
          el.scrollBy(args.x, args.y);
        },
        { x, y }
      );
    } else {
      await this.page.mouse.wheel(x, y);
    }
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  async uploadFile(ref: ElementRef, paths: string | readonly string[]): Promise<void> {
    const locator = this.resolveRef(ref);
    await locator.setInputFiles(paths);
  }

  async download(
    trigger: () => Promise<void>,
    options: DownloadOptions = {}
  ): Promise<DownloadResult> {
    const { timeout } = options;
    const [download] = await Promise.all([
      this.page.waitForEvent("download", ...(timeout !== undefined ? [{ timeout }] : [])),
      trigger(),
    ]);

    const path = await download.path();
    const suggestedFilename = download.suggestedFilename();

    if (!path) {
      throw new Error("PlaywrightBackend: download failed — path is null");
    }

    return { path, suggestedFilename };
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  onDialog(handler: (info: DialogInfo) => DialogAction | Promise<DialogAction>): void {
    this._dialogHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  async tabs(): Promise<readonly TabInfo[]> {
    const pages: AnyPage[] = this.context.pages();
    return Promise.all(
      pages.map(async (p: AnyPage, idx: number) => ({
        tabId: String(idx),
        url: p.url(),
        title: await p.title(),
      }))
    );
  }

  async switchTab(tabId: string): Promise<void> {
    const pages: AnyPage[] = this.context.pages();
    const idx = parseInt(tabId, 10);
    if (isNaN(idx) || idx < 0 || idx >= pages.length) {
      throw new Error(`PlaywrightBackend: no tab with id "${tabId}"`);
    }
    this._page = pages[idx];
    await this._page.bringToFront();
  }

  async newTab(url?: string): Promise<TabInfo> {
    const newPage: AnyPage = await this.context.newPage();
    if (url) {
      await newPage.goto(url, { waitUntil: "load" });
    }
    const pages: AnyPage[] = this.context.pages();
    const idx = pages.indexOf(newPage);
    const tabId = String(idx >= 0 ? idx : pages.length - 1);
    return {
      tabId,
      url: newPage.url(),
      title: await newPage.title(),
    };
  }

  async closeTab(tabId: string): Promise<void> {
    const pages: AnyPage[] = this.context.pages();
    const idx = parseInt(tabId, 10);
    if (isNaN(idx) || idx < 0 || idx >= pages.length) {
      throw new Error(`PlaywrightBackend: no tab with id "${tabId}"`);
    }
    const target = pages[idx];
    await target.close();

    // If we closed the active page, switch to the last remaining page
    if (this._page === target) {
      const remaining: AnyPage[] = this.context.pages();
      this._page = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  }

  // ---------------------------------------------------------------------------
  // Wait
  // ---------------------------------------------------------------------------

  async waitForNavigation(options: NavigateOptions = {}): Promise<void> {
    const { timeout } = options;
    await this.page.waitForLoadState("load", ...(timeout !== undefined ? [{ timeout }] : []));
  }

  async waitForSelector(selector: string, options: WaitOptions = {}): Promise<ElementRef> {
    const { timeout } = options;
    await this.page.waitForSelector(selector, ...(timeout !== undefined ? [{ timeout }] : []));

    const ref = `e${++this._refCounter.count}`;
    this._refMap.set(ref, `css:${selector}`);
    return ref;
  }

  async waitForIdle(options: WaitOptions = {}): Promise<void> {
    const { timeout } = options;
    await this.page.waitForLoadState(
      "networkidle",
      ...(timeout !== undefined ? [{ timeout }] : [])
    );
  }

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
