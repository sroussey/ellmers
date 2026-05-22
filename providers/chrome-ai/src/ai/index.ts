/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// organize-imports-ignore

export * from "./common/WebBrowser_Constants";
export * from "./common/WebBrowser_ModelSchema";
export * from "./registerWebBrowser";

import {
  CONSERVATIVE_PROBED_CAPABILITIES,
  inferWebBrowserCapabilities,
  inferWebBrowserCapabilitiesAsync,
  WEB_BROWSER_RUN_FN_SPECS,
} from "./common/WebBrowser_Capabilities";
import { _resetProbeCache, probeWebBrowserCapabilities } from "./common/WebBrowser_CapabilityProbe";
import {
  buildInitialPromptsFromHistory,
  findLastUserIndex,
  messageText,
} from "./common/WebBrowser_ChatHistory";
import { snapshotStreamToTextDeltas } from "./common/WebBrowser_ChromeHelpers";
import {
  WEB_BROWSER_RUN_FNS,
  WebBrowser_TextGeneration_Unified,
} from "./common/WebBrowser_JobRunFns";
import {
  deleteChromeSession,
  dropChromeSessionEntry,
  getChromeSession,
  setChromeSession,
} from "./common/WebBrowser_Sessions";
import { WebBrowser_StructuredGeneration } from "./common/WebBrowser_StructuredGeneration";
import { WebBrowser_ToolCalling } from "./common/WebBrowser_ToolCalling";
import { WebBrowserProvider } from "./WebBrowserProvider";

/**
 * @internal Symbols exported only for use by `@workglow/test`. Not part of the stable public API.
 */
export const _testOnly = {
  WebBrowserProvider,
  WEB_BROWSER_RUN_FN_SPECS,
  WEB_BROWSER_RUN_FNS,
  WebBrowser_TextGeneration_Unified,
  WebBrowser_StructuredGeneration,
  WebBrowser_ToolCalling,
  sessions: {
    getChromeSession,
    setChromeSession,
    deleteChromeSession,
    dropChromeSessionEntry,
  },
  chatHistory: {
    messageText,
    findLastUserIndex,
    buildInitialPromptsFromHistory,
  },
  chromeHelpers: {
    snapshotStreamToTextDeltas,
  },
  probe: {
    probeWebBrowserCapabilities,
    inferWebBrowserCapabilities,
    inferWebBrowserCapabilitiesAsync,
    CONSERVATIVE_PROBED_CAPABILITIES,
    _resetProbeCache,
  },
} as const;
