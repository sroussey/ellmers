/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/** Opaque reference to a specific element in the browser context. */
export type ElementRef = string;

/** Common ARIA roles with an escape hatch for non-standard values. */
export type AriaRole =
  | "alert"
  | "alertdialog"
  | "application"
  | "article"
  | "banner"
  | "button"
  | "cell"
  | "checkbox"
  | "columnheader"
  | "combobox"
  | "complementary"
  | "contentinfo"
  | "definition"
  | "dialog"
  | "directory"
  | "document"
  | "feed"
  | "figure"
  | "form"
  | "grid"
  | "gridcell"
  | "group"
  | "heading"
  | "img"
  | "link"
  | "list"
  | "listbox"
  | "listitem"
  | "log"
  | "main"
  | "marquee"
  | "math"
  | "menu"
  | "menubar"
  | "menuitem"
  | "menuitemcheckbox"
  | "menuitemradio"
  | "navigation"
  | "none"
  | "note"
  | "option"
  | "presentation"
  | "progressbar"
  | "radio"
  | "radiogroup"
  | "region"
  | "row"
  | "rowgroup"
  | "rowheader"
  | "scrollbar"
  | "search"
  | "searchbox"
  | "separator"
  | "slider"
  | "spinbutton"
  | "status"
  | "switch"
  | "tab"
  | "table"
  | "tablist"
  | "tabpanel"
  | "term"
  | "textbox"
  | "timer"
  | "toolbar"
  | "tooltip"
  | "tree"
  | "treegrid"
  | "treeitem"
  | (string & {});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

export interface AccessibilityNode {
  readonly ref: ElementRef;
  readonly role: AriaRole;
  readonly name: string;
  readonly level?: number;
  readonly checked?: boolean | "mixed";
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly pressed?: boolean | "mixed";
  readonly selected?: boolean;
  readonly value?: string | number;
  readonly children?: readonly AccessibilityNode[];
}

export interface AccessibilityTree {
  readonly root: AccessibilityNode;
  readonly yaml: string;
}

// ---------------------------------------------------------------------------
// Backend / connection
// ---------------------------------------------------------------------------

export type BrowserBackendType = "local" | "cloud" | "electron-native";

export interface BrowserConnectOptions {
  readonly backend?: BrowserBackendType;
  readonly projectId?: string;
  readonly profileName?: string;
  readonly headless?: boolean;
  readonly cdpUrl?: string;
  readonly chromePath?: string;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface NavigateOptions {
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle";
  readonly timeout?: number;
}

// ---------------------------------------------------------------------------
// Element interaction options
// ---------------------------------------------------------------------------

export interface ClickOptions {
  readonly modifiers?: ReadonlyArray<"Alt" | "Control" | "Meta" | "Shift">;
  readonly button?: "left" | "middle" | "right";
  readonly clickCount?: number;
  readonly timeout?: number;
}

export interface SnapshotOptions {
  readonly ref?: ElementRef;
}

// ---------------------------------------------------------------------------
// Capture options
// ---------------------------------------------------------------------------

export interface ScreenshotOptions {
  readonly format?: "png" | "jpeg";
  readonly quality?: number;
  readonly fullPage?: boolean;
}

// ---------------------------------------------------------------------------
// Wait / download options and results
// ---------------------------------------------------------------------------

export interface WaitOptions {
  readonly timeout?: number;
}

export interface DownloadOptions {
  readonly timeout?: number;
}

export interface DownloadResult {
  readonly path: string;
  readonly suggestedFilename: string;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export interface DialogInfo {
  readonly type: "alert" | "confirm" | "prompt" | "beforeunload";
  readonly message: string;
  readonly defaultValue?: string;
}

export type DialogAction =
  | { readonly accept: true; readonly promptText?: string }
  | { readonly accept: false };

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface TabInfo {
  readonly tabId: string;
  readonly url: string;
  readonly title: string;
}

// ---------------------------------------------------------------------------
// Network and console
// ---------------------------------------------------------------------------

export interface NetworkFilter {
  readonly urlPattern?: string;
  readonly method?: string;
}

export interface NetworkRequest {
  readonly url: string;
  readonly method: string;
  readonly status?: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ConsoleMessage {
  readonly type: "log" | "warn" | "error" | "info" | "debug";
  readonly text: string;
}

// ---------------------------------------------------------------------------
// IBrowserContext
// ---------------------------------------------------------------------------

export interface IBrowserContext {
  // -- Lifecycle ------------------------------------------------------------

  /** Establish a connection to the browser backend. */
  connect(options?: BrowserConnectOptions): Promise<void>;

  /** Disconnect from the browser backend and release resources. */
  disconnect(): Promise<void>;

  /** Returns true if the context is currently connected. */
  isConnected(): boolean;

  // -- Navigation -----------------------------------------------------------

  /** Navigate to the given URL. */
  navigate(url: string, options?: NavigateOptions): Promise<void>;

  /** Navigate back in history. */
  goBack(options?: NavigateOptions): Promise<void>;

  /** Navigate forward in history. */
  goForward(options?: NavigateOptions): Promise<void>;

  /** Reload the current page. */
  reload(options?: NavigateOptions): Promise<void>;

  /** Return the current page URL. */
  currentUrl(): Promise<string>;

  /** Return the current page title. */
  title(): Promise<string>;

  // -- Accessibility --------------------------------------------------------

  /** Return the accessibility tree of the current page or a subtree. */
  snapshot(options?: SnapshotOptions): Promise<AccessibilityTree>;

  // -- Element interaction (by ref) -----------------------------------------

  /** Click the element identified by the given ref. */
  click(ref: ElementRef, options?: ClickOptions): Promise<void>;

  /** Fill a text input identified by the given ref. */
  fill(ref: ElementRef, value: string, options?: WaitOptions): Promise<void>;

  /** Select an option in a <select> element identified by the given ref. */
  selectOption(
    ref: ElementRef,
    values: string | readonly string[],
    options?: WaitOptions
  ): Promise<void>;

  /** Hover over the element identified by the given ref. */
  hover(ref: ElementRef, options?: WaitOptions): Promise<void>;

  // -- Semantic interaction -------------------------------------------------

  /** Click the first element matching the given ARIA role and accessible name. */
  clickByRole(role: AriaRole, name: string, options?: ClickOptions): Promise<void>;

  /** Fill the input associated with the given label text. */
  fillByLabel(label: string, value: string, options?: WaitOptions): Promise<void>;

  // -- Content extraction ---------------------------------------------------

  /** Return the full HTML content of the page. */
  content(): Promise<string>;

  /** Return the innerHTML of the element identified by the given ref. */
  innerHTML(ref: ElementRef): Promise<string>;

  /** Return the textContent of the element identified by the given ref. */
  textContent(ref: ElementRef): Promise<string | null>;

  /** Return the value of a named attribute on the element identified by the given ref. */
  attribute(ref: ElementRef, name: string): Promise<string | null>;

  // -- CSS selector ---------------------------------------------------------

  /** Return the ElementRef of the first element matching the CSS selector. */
  querySelector(selector: string): Promise<ElementRef | null>;

  /** Return the ElementRefs of all elements matching the CSS selector. */
  querySelectorAll(selector: string): Promise<readonly ElementRef[]>;

  // -- JS evaluation --------------------------------------------------------

  /** Evaluate a JavaScript expression in the page context and return the result. */
  evaluate<T>(expression: string): Promise<T>;

  // -- Capture --------------------------------------------------------------

  /** Take a screenshot of the current page and return it as a Buffer. */
  screenshot(options?: ScreenshotOptions): Promise<Buffer>;

  // -- Input ----------------------------------------------------------------

  /** Press a keyboard key or chord (e.g. "Enter", "Control+a"). */
  pressKey(key: string, options?: WaitOptions): Promise<void>;

  /** Type text into the currently focused element. */
  type(text: string, options?: WaitOptions): Promise<void>;

  /** Scroll the page or an element by the given pixel deltas. */
  scroll(x: number, y: number, ref?: ElementRef): Promise<void>;

  // -- File operations ------------------------------------------------------

  /** Upload one or more files to a file input identified by the given ref. */
  uploadFile(ref: ElementRef, paths: string | readonly string[]): Promise<void>;

  /** Wait for a download triggered by the callback and return the result. */
  download(trigger: () => Promise<void>, options?: DownloadOptions): Promise<DownloadResult>;

  // -- Dialogs --------------------------------------------------------------

  /**
   * Register a handler that will be called whenever a dialog appears.
   * The handler must return a DialogAction synchronously or as a Promise.
   */
  onDialog(handler: (info: DialogInfo) => DialogAction | Promise<DialogAction>): void;

  // -- Tabs -----------------------------------------------------------------

  /** Return metadata for all open tabs. */
  tabs(): Promise<readonly TabInfo[]>;

  /** Switch the active tab to the one with the given tabId. */
  switchTab(tabId: string): Promise<void>;

  /** Open a new blank tab and return its TabInfo. */
  newTab(url?: string): Promise<TabInfo>;

  /** Close the tab with the given tabId. */
  closeTab(tabId: string): Promise<void>;

  // -- Wait -----------------------------------------------------------------

  /** Wait for the next navigation to complete. */
  waitForNavigation(options?: NavigateOptions): Promise<void>;

  /** Wait until the element matching selector is present in the DOM. */
  waitForSelector(selector: string, options?: WaitOptions): Promise<ElementRef>;

  /** Wait until there are no outstanding network requests. */
  waitForIdle(options?: WaitOptions): Promise<void>;

  // -- Optional capabilities ------------------------------------------------

  /** Return captured network requests (if supported by the backend). */
  readonly networkRequests?: (filter?: NetworkFilter) => Promise<readonly NetworkRequest[]>;

  /** Return captured console messages (if supported by the backend). */
  readonly consoleMessages?: () => Promise<readonly ConsoleMessage[]>;
}
