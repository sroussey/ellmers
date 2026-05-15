/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AccessibilityTree,
  AriaRole,
  BrowserConnectOptions,
  ClickOptions,
  DialogAction,
  DialogInfo,
  DownloadOptions,
  DownloadResult,
  ElementRef,
  IBrowserContext,
  NavigateOptions,
  ScreenshotOptions,
  SnapshotOptions,
  TabInfo,
  WaitOptions,
} from "@workglow/browser-control/task";

export interface CallRecord {
  method: string;
  args: unknown[];
}

export const MOCK_SNAPSHOT: AccessibilityTree = {
  root: {
    ref: "e0",
    role: "document",
    name: "Sign In",
    children: [
      {
        ref: "e1",
        role: "heading",
        name: "Sign In",
        level: 1,
      },
      {
        ref: "e2",
        role: "textbox",
        name: "Email address",
        value: "",
      },
      {
        ref: "e3",
        role: "textbox",
        name: "Password",
        value: "",
      },
      {
        ref: "e4",
        role: "button",
        name: "Sign in",
      },
      {
        ref: "e5",
        role: "link",
        name: "Forgot password?",
      },
    ],
  },
  yaml: [
    "- document [e0]: Sign In",
    "  - heading [e1] level=1: Sign In",
    "  - textbox [e2]: Email address",
    "  - textbox [e3]: Password",
    "  - button [e4]: Sign in",
    "  - link [e5]: Forgot password?",
  ].join("\n"),
};

export class MockBrowserContext implements IBrowserContext {
  calls: CallRecord[] = [];
  connected: boolean = false;
  currentPage: { url: string; title: string } = {
    url: "https://example.com/login",
    title: "Sign In",
  };

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  async connect(options?: BrowserConnectOptions): Promise<void> {
    this.record("connect", [options]);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.record("disconnect", []);
    this.connected = false;
  }

  isConnected(): boolean {
    this.record("isConnected", []);
    return this.connected;
  }

  async navigate(url: string, options?: NavigateOptions): Promise<void> {
    this.record("navigate", [url, options]);
    this.currentPage.url = url;
  }

  async goBack(options?: NavigateOptions): Promise<void> {
    this.record("goBack", [options]);
  }

  async goForward(options?: NavigateOptions): Promise<void> {
    this.record("goForward", [options]);
  }

  async reload(options?: NavigateOptions): Promise<void> {
    this.record("reload", [options]);
  }

  async currentUrl(): Promise<string> {
    this.record("currentUrl", []);
    return this.currentPage.url;
  }

  async title(): Promise<string> {
    this.record("title", []);
    return this.currentPage.title;
  }

  async snapshot(options?: SnapshotOptions): Promise<AccessibilityTree> {
    this.record("snapshot", [options]);
    return MOCK_SNAPSHOT;
  }

  async click(ref: ElementRef, options?: ClickOptions): Promise<void> {
    this.record("click", [ref, options]);
  }

  async fill(ref: ElementRef, value: string, options?: WaitOptions): Promise<void> {
    this.record("fill", [ref, value, options]);
  }

  async selectOption(
    ref: ElementRef,
    values: string | readonly string[],
    options?: WaitOptions
  ): Promise<void> {
    this.record("selectOption", [ref, values, options]);
  }

  async hover(ref: ElementRef, options?: WaitOptions): Promise<void> {
    this.record("hover", [ref, options]);
  }

  async clickByRole(role: AriaRole, name: string, options?: ClickOptions): Promise<void> {
    this.record("clickByRole", [role, name, options]);
  }

  async fillByLabel(label: string, value: string, options?: WaitOptions): Promise<void> {
    this.record("fillByLabel", [label, value, options]);
  }

  async content(): Promise<string> {
    this.record("content", []);
    return "<html><body><h1>Sign In</h1></body></html>";
  }

  async innerHTML(ref: ElementRef): Promise<string> {
    this.record("innerHTML", [ref]);
    return `<span>${ref}</span>`;
  }

  async textContent(ref: ElementRef): Promise<string | null> {
    this.record("textContent", [ref]);
    return ref;
  }

  async attribute(ref: ElementRef, name: string): Promise<string | null> {
    this.record("attribute", [ref, name]);
    return null;
  }

  async querySelector(selector: string): Promise<ElementRef | null> {
    this.record("querySelector", [selector]);
    return "e1";
  }

  async querySelectorAll(selector: string): Promise<readonly ElementRef[]> {
    this.record("querySelectorAll", [selector]);
    return ["e1", "e2"];
  }

  async evaluate<T>(expression: string): Promise<T> {
    this.record("evaluate", [expression]);
    return undefined as unknown as T;
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    this.record("screenshot", [options]);
    return Buffer.alloc(0);
  }

  async pressKey(key: string, options?: WaitOptions): Promise<void> {
    this.record("pressKey", [key, options]);
  }

  async type(text: string, options?: WaitOptions): Promise<void> {
    this.record("type", [text, options]);
  }

  async scroll(x: number, y: number, ref?: ElementRef): Promise<void> {
    this.record("scroll", [x, y, ref]);
  }

  async uploadFile(ref: ElementRef, paths: string | readonly string[]): Promise<void> {
    this.record("uploadFile", [ref, paths]);
  }

  async download(trigger: () => Promise<void>, options?: DownloadOptions): Promise<DownloadResult> {
    this.record("download", [options]);
    await trigger();
    return { path: "/tmp/mock-download.bin", suggestedFilename: "mock-download.bin" };
  }

  onDialog(handler: (info: DialogInfo) => DialogAction | Promise<DialogAction>): void {
    this.record("onDialog", [handler]);
  }

  async tabs(): Promise<readonly TabInfo[]> {
    this.record("tabs", []);
    return [{ tabId: "tab-1", url: this.currentPage.url, title: this.currentPage.title }];
  }

  async switchTab(tabId: string): Promise<void> {
    this.record("switchTab", [tabId]);
  }

  async newTab(url?: string): Promise<TabInfo> {
    this.record("newTab", [url]);
    return { tabId: "tab-2", url: url ?? "about:blank", title: "" };
  }

  async closeTab(tabId: string): Promise<void> {
    this.record("closeTab", [tabId]);
  }

  async waitForNavigation(options?: NavigateOptions): Promise<void> {
    this.record("waitForNavigation", [options]);
  }

  async waitForSelector(selector: string, options?: WaitOptions): Promise<ElementRef> {
    this.record("waitForSelector", [selector, options]);
    return "e1";
  }

  async waitForIdle(options?: WaitOptions): Promise<void> {
    this.record("waitForIdle", [options]);
  }
}
