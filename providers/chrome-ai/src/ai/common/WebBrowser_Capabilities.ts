/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import { WEB_BROWSER_CAPABILITY_SETS } from "./WebBrowser_CapabilitySets";

export const WEB_BROWSER_RUN_FN_SPECS = WEB_BROWSER_CAPABILITY_SETS.map((serves) => ({ serves }));

export function webBrowserWorkerRunFnSpecs(): readonly {
  readonly serves: readonly Capability[];
}[] {
  return WEB_BROWSER_RUN_FN_SPECS;
}

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Heuristic capability inference for Chrome Built-in AI {@link ModelRecord}.
 *
 * Chrome's Built-in AI exposes a fixed set of feature APIs identified by
 * model_id (e.g. `chrome-prompt`, `chrome-summarizer`, `chrome-rewriter`,
 * `chrome-translator`, `chrome-language-detector`). Declared capabilities
 * win; fallback maps the canonical chrome-* prefixes.
 */
export function inferWebBrowserCapabilities(model: CapabilityHints): readonly Capability[] {
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;

  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );
  const baseName = id.toLowerCase();

  if (/prompt|gemini[-_]?nano/.test(baseName)) {
    return [
      "text.generation",
      "json-mode",
      "tool-use",
      "text.rewriter",
      "text.summary",
      "model.info",
      "model.search",
    ];
  }
  if (/summariz/.test(baseName)) {
    return ["text.summary", "model.info", "model.search"];
  }
  if (/rewrit/.test(baseName)) {
    return ["text.rewriter", "model.info", "model.search"];
  }
  if (/translat/.test(baseName)) {
    return ["text.translation", "model.info", "model.search"];
  }
  if (/language[-_]?detect/.test(baseName)) {
    return ["text.language-detection", "model.info", "model.search"];
  }

  return ["model.search", "model.info"];
}
