/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelRecord,
} from "@workglow/ai/worker";
import { AiProvider } from "@workglow/ai/worker";
import {
  CONSERVATIVE_PROBED_CAPABILITIES,
  inferWebBrowserCapabilities,
  webBrowserWorkerRunFnSpecs,
} from "./common/WebBrowser_Capabilities";
import {
  probeWebBrowserCapabilities,
  type WebBrowserProbeFactory,
  type WebBrowserProbedCapabilities,
} from "./common/WebBrowser_CapabilityProbe";
import { WEB_BROWSER } from "./common/WebBrowser_Constants";
import type { WebBrowserModelConfig } from "./common/WebBrowser_ModelSchema";
import { deleteChromeSession } from "./common/WebBrowser_Sessions";

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
  readonly supportsServer = false;

  /**
   * Result of {@link probeWebBrowserCapabilities}. Until the probe resolves
   * we report the conservative subset (no `json-mode`, no `tool-use`) so we
   * never advertise a capability a downstream task can't fulfil. Callers
   * that need the final answer should await {@link ready}.
   */
  private probedCaps: WebBrowserProbedCapabilities = CONSERVATIVE_PROBED_CAPABILITIES;
  private readonly probeReady: Promise<void>;

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<any, any, WebBrowserModelConfig>[],
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, WebBrowserModelConfig>>,
    /**
     * Test seam: injectable probe factory. Production callers leave this
     * undefined so the probe resolves against the real `LanguageModel`
     * global.
     */
    probeFactory?: WebBrowserProbeFactory
  ) {
    super(promiseRunFns, previewTasks);
    this.probeReady = probeWebBrowserCapabilities(probeFactory).then((result) => {
      this.probedCaps = result;
    });
  }

  /**
   * Resolves once the capability probe has completed. After this point
   * {@link inferCapabilities} reflects what the browser actually supports.
   * Before this point it returns the conservative subset.
   */
  ready(): Promise<void> {
    return this.probeReady;
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferWebBrowserCapabilities(model, this.probedCaps);
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return webBrowserWorkerRunFnSpecs();
  }

  /**
   * Chrome Built-in AI is only reachable when the browser exposes at least one
   * of its API globals.
   */
  override async isAvailable(): Promise<boolean> {
    const g = globalThis as Record<string, unknown>;
    return (
      typeof g.LanguageModel !== "undefined" ||
      typeof g.Summarizer !== "undefined" ||
      typeof g.Translator !== "undefined" ||
      typeof g.Rewriter !== "undefined" ||
      typeof g.LanguageDetector !== "undefined"
    );
  }

  /**
   * Releases any cached Chrome `LanguageModel` session for the given id.
   * `AiChatTask` registers this via `ResourceScope` so multi-turn chat
   * sessions are torn down when the owning run completes.
   */
  override async disposeSession(sessionId: string): Promise<void> {
    deleteChromeSession(sessionId);
  }
}
