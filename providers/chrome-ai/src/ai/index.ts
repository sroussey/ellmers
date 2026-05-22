/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export { queryWebBrowserModelStatus } from "./common/WebBrowser_ChromeHelpers";
export * from "./common/WebBrowser_Constants";
export * from "./common/WebBrowser_ModelSchema";
export * from "./registerWebBrowser";

import { WEB_BROWSER_RUN_FN_SPECS } from "./common/WebBrowser_Capabilities";
import { WebBrowser_Chat } from "./common/WebBrowser_Chat";
import { WEB_BROWSER_RUN_FNS } from "./common/WebBrowser_JobRunFns";
import {
  WEB_BROWSER_SESSION_IDLE_MS,
  disposeWebBrowserSession,
  disposeWebBrowserSessionsForModel,
  getWebBrowserModelKey,
  getWebBrowserSession,
  resetWebBrowserSessionsForTests,
  setWebBrowserSession,
  touchWebBrowserSession,
} from "./common/WebBrowser_Sessions";
import { WebBrowserProvider } from "./WebBrowserProvider";

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the stable public API.
 */
export const _testOnly = {
  WebBrowserProvider,
  WEB_BROWSER_RUN_FN_SPECS,
  WEB_BROWSER_RUN_FNS,
  WebBrowser_Chat,
  WEB_BROWSER_SESSION_IDLE_MS,
  disposeWebBrowserSession,
  disposeWebBrowserSessionsForModel,
  getWebBrowserModelKey,
  getWebBrowserSession,
  resetWebBrowserSessionsForTests,
  setWebBrowserSession,
  touchWebBrowserSession,
} as const;
