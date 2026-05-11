/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./common/WebBrowser_Constants";
export * from "./common/WebBrowser_ModelSchema";
export * from "./registerWebBrowser";

import { WEB_BROWSER_RUN_FN_SPECS } from "./common/WebBrowser_Capabilities";
import { WEB_BROWSER_RUN_FNS } from "./common/WebBrowser_JobRunFns";
import { WebBrowserProvider } from "./WebBrowserProvider";

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the stable public API.
 */
export const _testOnly = {
  WebBrowserProvider,
  WEB_BROWSER_RUN_FN_SPECS,
  WEB_BROWSER_RUN_FNS,
} as const;
