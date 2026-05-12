/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderLegacyStreamFnRegistration,
  AiProviderPreviewRunFn,
  Capability,
  ModelRecord,
} from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import { WEB_BROWSER } from "./common/WebBrowser_Constants";
import {
  inferWebBrowserCapabilities,
  webBrowserWorkerRunFnSpecs,
} from "./common/WebBrowser_Capabilities";
import type { WebBrowserModelConfig } from "./common/WebBrowser_ModelSchema";

/**
 * AI provider for Chrome Built-in AI APIs (Gemini Nano on-device).
 *
 * Browser-only provider — no external SDK needed, the APIs are browser globals.
 * Used both for worker-server registration and for main-thread shell use
 * (no queue — direct execution).
 */
export class WebBrowserProvider extends AiProvider<WebBrowserModelConfig> {
  readonly name = WEB_BROWSER;
  readonly displayName = "Chrome Built-in AI";
  readonly isLocal = true;
  readonly supportsBrowser = true;

  constructor(
    runFns?: readonly AiProviderLegacyStreamFnRegistration<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      WebBrowserModelConfig
    >[],
    previewTasks?: Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      AiProviderPreviewRunFn<any, any, WebBrowserModelConfig>
    >
  ) {
    super(runFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferWebBrowserCapabilities(model);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return webBrowserWorkerRunFnSpecs();
  }
}
