/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Capability, ModelRecord } from "@workglow/ai/worker";
import {
  CONSERVATIVE_PROBED_CAPABILITIES,
  probeWebBrowserCapabilities,
  type WebBrowserProbeFactory,
  type WebBrowserProbedCapabilities,
} from "./WebBrowser_CapabilityProbe";
import { WEB_BROWSER_CAPABILITY_SETS } from "./WebBrowser_CapabilitySets";

export const WEB_BROWSER_RUN_FN_SPECS = WEB_BROWSER_CAPABILITY_SETS.map((serves) => ({ serves }));

export function webBrowserWorkerRunFnSpecs(): readonly {
  readonly serves: readonly Capability[];
}[] {
  return WEB_BROWSER_RUN_FN_SPECS;
}

type CapabilityHints = Pick<ModelRecord, "model_id" | "provider_config" | "capabilities">;

/**
 * Capabilities the `chrome-prompt`/`gemini-nano` family advertises
 * *unconditionally*. `json-mode` and `tool-use` are gated separately because
 * the `responseConstraint` and `tools` options on `LanguageModel.create` /
 * `prompt` aren't universally supported across Chrome builds and channels.
 */
const PROMPT_BASE_CAPABILITIES = [
  "text.generation",
  "text.rewriter",
  "text.summary",
  "model.info",
  "model.search",
] as const satisfies readonly Capability[];

/**
 * Heuristic capability inference for Chrome Built-in AI {@link ModelRecord}.
 *
 * Chrome's Built-in AI exposes a fixed set of feature APIs identified by
 * model_id (e.g. `chrome-prompt`, `chrome-summarizer`, `chrome-rewriter`,
 * `chrome-translator`, `chrome-language-detector`). Declared capabilities
 * win; fallback maps the canonical chrome-* prefixes.
 *
 * `json-mode` and `tool-use` are conditional on browser support — pass a
 * known {@link WebBrowserProbedCapabilities} result via `probed` to gate
 * them. Defaults to `{jsonMode: true, toolUse: true}` for back-compat with
 * callers that haven't adopted the probe yet; new callers should pass
 * either the probe result or `CONSERVATIVE_PROBED_CAPABILITIES`.
 *
 * For an async variant that drives the probe automatically see
 * {@link inferWebBrowserCapabilitiesAsync}.
 */
export function inferWebBrowserCapabilities(
  model: CapabilityHints,
  probed: WebBrowserProbedCapabilities = { jsonMode: true, toolUse: true }
): readonly Capability[] {
  const declared = (model.capabilities as readonly Capability[] | undefined) ?? [];
  if (declared.length > 0) return declared;

  const id = String(
    model.model_id ??
      (model.provider_config as { model_name?: string } | undefined)?.model_name ??
      ""
  );
  const baseName = id.toLowerCase();

  if (/prompt|gemini[-_]?nano/.test(baseName)) {
    const caps: Capability[] = [...PROMPT_BASE_CAPABILITIES];
    if (probed.jsonMode) caps.splice(1, 0, "json-mode");
    if (probed.toolUse) {
      // Insert tool-use after json-mode (if present) for stable test ordering.
      const insertAt = probed.jsonMode ? 2 : 1;
      caps.splice(insertAt, 0, "tool-use");
    }
    return caps;
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

/**
 * Probe-driven variant of {@link inferWebBrowserCapabilities}. Resolves the
 * probed capability set (cached) before returning, so the result reflects
 * the real browser surface rather than assuming both `json-mode` and
 * `tool-use` are present.
 */
export async function inferWebBrowserCapabilitiesAsync(
  model: CapabilityHints,
  factory?: WebBrowserProbeFactory
): Promise<readonly Capability[]> {
  const probed = await probeWebBrowserCapabilities(factory);
  return inferWebBrowserCapabilities(model, probed);
}

export { CONSERVATIVE_PROBED_CAPABILITIES };
