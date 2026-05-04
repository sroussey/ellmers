/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { sleep } from "@workglow/util";
import { CDPBrowserBackend } from "./CDPBrowserBackend";
import type {
  BrowserConnectOptions,
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
  TabInfo,
  WaitOptions,
} from "./IBrowserContext";

// ---------------------------------------------------------------------------
// Electron types (not imported at module level — lazy optional dependency)
// ---------------------------------------------------------------------------

/** @type {import("electron").BrowserWindow} */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBrowserWindow = any;

/** @type {import("electron").WebContents} */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWebContents = any;

// ---------------------------------------------------------------------------
// Lazy Electron loader
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let electronModule: Record<string, any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getElectron(): Promise<Record<string, any>> {
  if (!electronModule) {
    // Dynamic import keeps electron as a true optional dependency.
    // The `Function` cast avoids a static "cannot find module" TS error
    // when electron types are not installed in the current environment.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    electronModule = (await new Function("m", "return import(m)")("electron")) as Record<
      string,
      any
    >;
  }
  return electronModule;
}

// ---------------------------------------------------------------------------
// ElectronBackend
// ---------------------------------------------------------------------------

/**
 * IBrowserContext implementation using Electron's native webContents + CDP.
 *
 * This file is only imported from the Electron main process. It must NOT be
 * included in browser/bun/node entry points.
 *
 * Session isolation is achieved via `session.fromPartition(partitionString)`
 * scoped to projectId + profileName.
 */
export class ElectronBackend extends CDPBrowserBackend implements IBrowserContext {
  /** @type {AnyBrowserWindow} Electron BrowserWindow instance */
  private _window: AnyBrowserWindow | null = null;

  /** @type {AnyWebContents} Electron webContents instance */
  private _webContents: AnyWebContents | null = null;

  private _connected = false;

  // Dialog handler
  private _dialogHandler: ((info: DialogInfo) => DialogAction | Promise<DialogAction>) | null =
    null;

  protected readonly backendName = "ElectronBackend";

  // ---------------------------------------------------------------------------
  // CDP helper
  // ---------------------------------------------------------------------------

  /**
   * Send a Chrome DevTools Protocol command via the Electron debugger.
   * @param method CDP method name (e.g. "DOM.getBoxModel")
   * @param params CDP parameters
   */
  protected async cdp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this._webContents) {
      throw new Error("ElectronBackend: not connected — call connect() first");
    }
    return this._webContents.debugger.sendCommand(method, params);
  }

  // ---------------------------------------------------------------------------
  // evaluateInPage (abstract from CDPBrowserBackend)
  // ---------------------------------------------------------------------------

  protected async evaluateInPage<T>(script: string): Promise<T> {
    return this.wc.executeJavaScript(script);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async connect(options: BrowserConnectOptions = {}): Promise<void> {
    const electron = await getElectron();
    const { BrowserWindow, session: electronSession } = electron;

    const { projectId = "default", profileName = "default", headless = false } = options;

    const partitionString = `persist:${projectId}:${profileName}`;
    const sess = electronSession.fromPartition(partitionString);

    this._window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: !headless,
      webPreferences: {
        session: sess,
        nodeIntegration: false,
        contextIsolation: true,
      },
    }) as AnyBrowserWindow;

    this._webContents = this._window.webContents as AnyWebContents;

    // Attach CDP debugger
    try {
      this._webContents.debugger.attach("1.3");
    } catch {
      // Already attached or version not supported — continue
    }

    // Enable Accessibility domain
    await this.cdp("Accessibility.enable");

    // Wire dialog handler
    this._webContents.on(
      "select-client-certificate",
      (_event: unknown, _url: unknown, _list: unknown, callback: (cert: unknown) => void) => {
        callback(undefined);
      }
    );

    this._webContents.on("will-prevent-unload", (event: { preventDefault: () => void }) => {
      event.preventDefault();
    });

    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    try {
      if (this._webContents) {
        try {
          this._webContents.debugger.detach();
        } catch {
          // Ignore detach errors
        }
      }
      if (this._window && !this._window.isDestroyed()) {
        this._window.close();
      }
    } finally {
      this._window = null;
      this._webContents = null;
      this._refMap.clear();
      this._refCounter.count = 0;
    }
  }

  isConnected(): boolean {
    return this._connected && this._window !== null && !this._window.isDestroyed();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private get wc(): AnyWebContents {
    if (!this._webContents || !this._connected) {
      throw new Error("ElectronBackend: not connected — call connect() first");
    }
    return this._webContents;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async navigate(url: string, _options: NavigateOptions = {}): Promise<void> {
    await this.wc.loadURL(url);
  }

  async goBack(_options: NavigateOptions = {}): Promise<void> {
    this.wc.navigationHistory.goBack();
    await this.waitForNavigation();
  }

  async goForward(_options: NavigateOptions = {}): Promise<void> {
    this.wc.navigationHistory.goForward();
    await this.waitForNavigation();
  }

  async reload(_options: NavigateOptions = {}): Promise<void> {
    this.wc.reload();
    await this.waitForNavigation();
  }

  async currentUrl(): Promise<string> {
    return this.wc.getURL();
  }

  async title(): Promise<string> {
    return this.wc.getTitle();
  }

  // ---------------------------------------------------------------------------
  // Content extraction
  // ---------------------------------------------------------------------------

  async content(): Promise<string> {
    return this.wc.executeJavaScript("document.documentElement.outerHTML") as Promise<string>;
  }

  // ---------------------------------------------------------------------------
  // JS evaluation
  // ---------------------------------------------------------------------------

  async evaluate<T>(expression: string): Promise<T> {
    return this.wc.executeJavaScript(expression) as Promise<T>;
  }

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    const { format = "png", quality } = options;

    const image = await this.wc.capturePage();

    if (format === "jpeg") {
      return image.toJPEG(quality ?? 90) as Buffer;
    }
    return image.toPNG() as Buffer;
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  async download(
    trigger: () => Promise<void>,
    options: DownloadOptions = {}
  ): Promise<DownloadResult> {
    const os = await import("node:os");
    const downloadDir = os.tmpdir();
    const timeout = options.timeout ?? 30_000;

    // Set up download behavior via CDP
    await this.cdp("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
    });

    let downloadPath = "";
    let suggestedFilename = "";

    // Listen for download completion.
    // Electron's will-download signature: (event, item, webContents)
    const downloadPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("ElectronBackend: download timed out"));
      }, timeout);

      const handler = (_event: unknown, item: AnyWebContents, _webContents: unknown) => {
        // item is a DownloadItem
        suggestedFilename = item.getFilename ? item.getFilename() : "download";
        item.once?.("done", (_e: unknown, state: string) => {
          clearTimeout(timer);
          if (state === "completed") {
            downloadPath = item.getSavePath
              ? item.getSavePath()
              : downloadDir + "/" + suggestedFilename;
          }
          resolve();
        });
      };
      this.wc.session.once("will-download", handler);
    });

    await trigger();
    await downloadPromise;

    if (!downloadPath) {
      throw new Error("ElectronBackend: download failed — no path received");
    }

    return { path: downloadPath, suggestedFilename };
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  onDialog(handler: (info: DialogInfo) => DialogAction | Promise<DialogAction>): void {
    this._dialogHandler = handler;

    // Use CDP Page.javascriptDialogOpening to intercept alert/confirm/prompt dialogs.
    // This requires Page domain to be enabled.
    void this.cdp("Page.enable").then(() => {
      this.wc.debugger.on(
        "message",
        async (_event: unknown, method: string, params: Record<string, unknown>) => {
          if (method !== "Page.javascriptDialogOpening") return;

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
    });
  }

  // ---------------------------------------------------------------------------
  // Tabs (simplified single-window model)
  // ---------------------------------------------------------------------------

  async tabs(): Promise<readonly TabInfo[]> {
    const url = this.wc.getURL();
    const title = this.wc.getTitle();
    return [{ tabId: "0", url, title }];
  }

  async switchTab(_tabId: string): Promise<void> {
    // Single-window model: no-op
  }

  async newTab(url?: string): Promise<TabInfo> {
    if (url) {
      await this.navigate(url);
    }
    return {
      tabId: "0",
      url: this.wc.getURL(),
      title: this.wc.getTitle(),
    };
  }

  async closeTab(_tabId: string): Promise<void> {
    // Single-window model: closing the tab means closing the window
    await this.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Wait
  // ---------------------------------------------------------------------------

  async waitForNavigation(options: NavigateOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 30_000;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("ElectronBackend: waitForNavigation timed out"));
      }, timeout);

      this.wc.once("did-finish-load", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async waitForSelector(selector: string, options: WaitOptions = {}): Promise<ElementRef> {
    const timeout = options.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const found = await this.wc.executeJavaScript(
        `!!document.querySelector(${JSON.stringify(selector)})`
      );
      if (found) {
        const ref = await this.querySelector(selector);
        if (ref) return ref;
      }
      await sleep(interval);
    }

    throw new Error(`ElectronBackend: waitForSelector timed out for "${selector}"`);
  }

  async waitForIdle(options: WaitOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 30_000;
    const interval = 100;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const ready = await this.wc.executeJavaScript(`document.readyState === "complete"`);
      if (ready) return;
      await sleep(interval);
    }

    throw new Error("ElectronBackend: waitForIdle timed out");
  }

  // ---------------------------------------------------------------------------
  // Optional capabilities
  // ---------------------------------------------------------------------------

  readonly networkRequests = (_filter?: NetworkFilter): Promise<readonly NetworkRequest[]> => {
    return Promise.resolve([]);
  };

  readonly consoleMessages = (): Promise<readonly ConsoleMessage[]> => {
    return Promise.resolve([]);
  };
}
