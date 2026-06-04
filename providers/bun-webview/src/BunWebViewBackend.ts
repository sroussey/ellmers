/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BrowserConnectOptions,
  DialogAction,
  DialogInfo,
  DownloadOptions,
  DownloadResult,
  ElementRef,
  IBrowserContext,
  NavigateOptions,
  ScreenshotOptions,
  TabInfo,
  WaitOptions,
} from "@workglow/browser-control/task";
import { CDPBrowserBackend } from "@workglow/browser-control/task";
import { sleep } from "@workglow/util";

// Bun.WebView is accessed via globalThis at runtime
/** @type {InstanceType<typeof Bun.WebView>} */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWebView = any;

/**
 * IBrowserContext implementation using Bun's built-in WebView API + CDP.
 *
 * Bun.WebView provides a headless browser with Chrome DevTools Protocol
 * access. This backend wraps the WebView, delegating CDP operations to the
 * abstract CDPBrowserBackend base class and using native WebView methods
 * for navigation, screenshots, and keyboard input.
 *
 * This file should only be imported in Bun environments.
 */
export class BunWebViewBackend extends CDPBrowserBackend implements IBrowserContext {
  private _wv: AnyWebView | null = null;
  private _connected = false;

  private _dialogHandler: ((info: DialogInfo) => DialogAction | Promise<DialogAction>) | null =
    null;

  protected readonly backendName = "BunWebViewBackend";

  /**
   * @param defaultChromePath Optional default Chrome binary path. Used when
   *   `connect()` is called without `chromePath` in options (e.g., via
   *   BrowserSessionTask which doesn't expose chromePath in its config).
   */
  constructor(private readonly defaultChromePath?: string) {
    super();
  }

  protected async cdp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.wv.cdp(method, params);
  }

  protected async evaluateInPage<T>(script: string): Promise<T> {
    return this.wv.evaluate(script) as Promise<T>;
  }

  async connect(options: BrowserConnectOptions = {}): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BunWebView = (globalThis as any).Bun?.WebView;
    if (!BunWebView) {
      throw new Error(
        "BunWebViewBackend: Bun.WebView is not available — " +
          "this backend requires Bun with WebView support"
      );
    }

    const { headless = true, chromePath = this.defaultChromePath } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webViewOptions: Record<string, any> = {
      headless,
      url: "about:blank",
      backend: chromePath ? { type: "chrome", path: chromePath } : { type: "chrome" },
    };

    this._wv = new BunWebView(webViewOptions);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("BunWebViewBackend: initial navigation timed out"));
      }, 30_000);

      this._wv!.onNavigated = () => {
        clearTimeout(timeout);
        this._wv!.onNavigated = null;
        this._wv!.onNavigationFailed = null;
        resolve();
      };

      this._wv!.onNavigationFailed = (error: unknown) => {
        clearTimeout(timeout);
        this._wv!.onNavigated = null;
        this._wv!.onNavigationFailed = null;
        reject(new Error(`BunWebViewBackend: initial navigation failed — ${error}`));
      };
    });

    // Enable Accessibility domain for snapshot/queryAXTree
    await this.cdp("Accessibility.enable");

    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    try {
      if (this._wv) {
        this._wv.close();
      }
    } finally {
      this._wv = null;
      this._refMap.clear();
      this._refCounter.count = 0;
    }
  }

  isConnected(): boolean {
    return this._connected && this._wv !== null;
  }

  private get wv(): AnyWebView {
    if (!this._wv || !this._connected) {
      throw new Error("BunWebViewBackend: not connected — call connect() first");
    }
    return this._wv;
  }

  async navigate(url: string, options: NavigateOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 30_000;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("BunWebViewBackend: navigate timed out"));
      }, timeout);

      this.wv.onNavigated = () => {
        clearTimeout(timer);
        this.wv.onNavigated = null;
        resolve();
      };

      this.wv.onNavigationFailed = (error: unknown) => {
        clearTimeout(timer);
        this.wv.onNavigationFailed = null;
        this.wv.onNavigated = null;
        reject(new Error(`BunWebViewBackend: navigation failed — ${error}`));
      };

      this.wv.navigate(url);
    });
  }

  async goBack(_options: NavigateOptions = {}): Promise<void> {
    this.wv.back();
    await this.waitForNavigation();
  }

  async goForward(_options: NavigateOptions = {}): Promise<void> {
    this.wv.forward();
    await this.waitForNavigation();
  }

  async reload(_options: NavigateOptions = {}): Promise<void> {
    this.wv.reload();
    await this.waitForNavigation();
  }

  async currentUrl(): Promise<string> {
    return this.wv.url;
  }

  async title(): Promise<string> {
    return this.wv.title;
  }

  async content(): Promise<string> {
    return this.wv.evaluate("document.documentElement.outerHTML") as Promise<string>;
  }

  async evaluate<T>(expression: string): Promise<T> {
    return this.wv.evaluate(expression) as Promise<T>;
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    const { format = "png", quality } = options;
    return this.wv.screenshot({
      encoding: "buffer",
      format,
      ...(quality !== undefined && { quality }),
    }) as Promise<Buffer>;
  }

  override async pressKey(key: string, _options: WaitOptions = {}): Promise<void> {
    await this.wv.press(key);
  }

  override async type(text: string, _options: WaitOptions = {}): Promise<void> {
    await this.wv.type(text);
  }

  async download(
    _trigger: () => Promise<void>,
    _options: DownloadOptions = {}
  ): Promise<DownloadResult> {
    throw new Error("BunWebViewBackend: download is not supported");
  }

  onDialog(handler: (info: DialogInfo) => DialogAction | Promise<DialogAction>): void {
    this._dialogHandler = handler;

    void this.cdp("Page.enable")
      .then(() => {
        this.wv.addEventListener(
          "Page.javascriptDialogOpening",
          async (params: Record<string, unknown>) => {
            const info: DialogInfo = {
              type: params.type as DialogInfo["type"],
              message: params.message as string,
              defaultValue: (params.defaultPrompt as string) || undefined,
            };

            if (this._dialogHandler) {
              const action = await this._dialogHandler(info);
              const accept = action.accept;
              const promptText =
                accept && "promptText" in action
                  ? (action as { accept: true; promptText?: string }).promptText
                  : undefined;
              await this.cdp("Page.handleJavaScriptDialog", {
                accept,
                ...(promptText !== undefined && { promptText }),
              });
            } else {
              await this.cdp("Page.handleJavaScriptDialog", { accept: false });
            }
          }
        );
      })
      .catch(() => {
        // Page.enable failed — dialog handler will not be wired up.
        // This is non-fatal: the session still works, but dialogs won't be
        // handled automatically and may block page execution.
      });
  }

  // Single-view model: closing a tab closes the WebView.

  async tabs(): Promise<readonly TabInfo[]> {
    const url = this.wv.url;
    const title = this.wv.title;
    return [{ tabId: "0", url, title }];
  }

  async switchTab(_tabId: string): Promise<void> {}

  async newTab(url?: string): Promise<TabInfo> {
    if (url) {
      await this.navigate(url);
    }
    return {
      tabId: "0",
      url: this.wv.url,
      title: this.wv.title,
    };
  }

  async closeTab(_tabId: string): Promise<void> {
    await this.disconnect();
  }

  async waitForNavigation(options: NavigateOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 30_000;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.wv.onNavigated = null;
        this.wv.onNavigationFailed = null;
        reject(new Error("BunWebViewBackend: waitForNavigation timed out"));
      }, timeout);

      this.wv.onNavigated = () => {
        clearTimeout(timer);
        this.wv.onNavigated = null;
        this.wv.onNavigationFailed = null;
        resolve();
      };

      this.wv.onNavigationFailed = (error: unknown) => {
        clearTimeout(timer);
        this.wv.onNavigated = null;
        this.wv.onNavigationFailed = null;
        reject(new Error(`BunWebViewBackend: navigation failed — ${error}`));
      };
    });
  }

  async waitForSelector(selector: string, options: WaitOptions = {}): Promise<ElementRef> {
    const timeout = options.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const found = await this.wv.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (found) {
        const ref = await this.querySelector(selector);
        if (ref) return ref;
      }
      await sleep(interval);
    }

    throw new Error(`BunWebViewBackend: waitForSelector timed out for "${selector}"`);
  }

  async waitForIdle(options: WaitOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const ready = await this.wv.evaluate(`document.readyState === "complete"`);
      if (ready) return;
      await sleep(interval);
    }

    throw new Error("BunWebViewBackend: waitForIdle timed out");
  }

  // networkRequests and consoleMessages are intentionally undefined: the
  // IBrowserContext contract requires optional methods to be either fully
  // implemented or undefined — never empty stubs that defeat feature detection.
}
