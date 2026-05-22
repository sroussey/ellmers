/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderPreviewRunFn,
  AiProviderRunFnRegistration,
  Capability,
  ModelConfig,
  ModelRecord,
} from "@workglow/ai/worker";
import { AiProvider, getAiProviderRegistry } from "@workglow/ai/worker";
import type { TaskInput } from "@workglow/task-graph";
import {
  inferWebBrowserCapabilities,
  webBrowserWorkerRunFnSpecs,
} from "./common/WebBrowser_Capabilities";
import { WEB_BROWSER } from "./common/WebBrowser_Constants";
import type { WebBrowserModelConfig } from "./common/WebBrowser_ModelSchema";
import { disposeWebBrowserSession } from "./common/WebBrowser_Sessions";

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
  private readonly sessionModels = new Map<string, WebBrowserModelConfig>();

  constructor(
    promiseRunFns?: readonly AiProviderRunFnRegistration<
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
    super(promiseRunFns, previewTasks);
  }

  override inferCapabilities(model: ModelRecord): readonly Capability[] {
    return inferWebBrowserCapabilities(model);
  }

  override createSession(model: ModelConfig): string {
    const sessionId = crypto.randomUUID();
    this.sessionModels.set(sessionId, model as WebBrowserModelConfig);
    return sessionId;
  }

  override async disposeSession(sessionId: string): Promise<void> {
    const model = this.sessionModels.get(sessionId);
    this.sessionModels.delete(sessionId);
    if (!model) {
      await disposeWebBrowserSession(sessionId);
      return;
    }

    const disposeFn = getAiProviderRegistry().getRunFnFor(this.name, ["model.dispose"]);
    if (!disposeFn) {
      await disposeWebBrowserSession(sessionId);
      return;
    }

    await disposeFn(
      { model, sessionId } as TaskInput,
      model,
      AbortSignal.timeout(30_000),
      () => {}
    );
  }

  protected override workerRunFnSpecs(): readonly { serves: readonly Capability[] }[] {
    return webBrowserWorkerRunFnSpecs();
  }
}
