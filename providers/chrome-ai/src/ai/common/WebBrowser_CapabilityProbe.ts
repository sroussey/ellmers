/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getApi } from "./WebBrowser_ChromeHelpers";

/**
 * Result of probing Chrome Built-in AI's `LanguageModel` for the optional
 * capabilities our run-fns rely on. Chrome's surface evolves and some flags
 * (json-mode via `responseConstraint`, tool-use via `tools`) are not
 * universally available — feature detection is the only reliable signal.
 */
export interface WebBrowserProbedCapabilities {
  readonly jsonMode: boolean;
  readonly toolUse: boolean;
}

/**
 * Minimal subset of the `LanguageModel` static surface the probe touches.
 * Declared here so tests can pass a fake factory without depending on the
 * `@types/dom-chromium-ai` ambient globals.
 */
export interface WebBrowserProbeFactory {
  create(options?: unknown): Promise<{ destroy(): unknown }>;
  params?(): Promise<unknown>;
}

/**
 * Default conservative probe result. Used when the `LanguageModel` global
 * is absent (e.g. running outside Chrome) so callers can still proceed —
 * just without `json-mode` / `tool-use` capabilities exposed.
 */
export const CONSERVATIVE_PROBED_CAPABILITIES: WebBrowserProbedCapabilities = Object.freeze({
  jsonMode: false,
  toolUse: false,
});

/**
 * Module-level coalescing slot so concurrent `probeWebBrowserCapabilities()`
 * callers share the same in-flight promise. Cleared via {@link _resetProbeCache}
 * for tests only.
 */
let probePromise: Promise<WebBrowserProbedCapabilities> | undefined;

/**
 * Probe the running browser for `json-mode` and `tool-use` support on the
 * `LanguageModel` API. Results are cached at module level; subsequent calls
 * (and concurrent calls) return the same promise so we only pay for one set
 * of create/destroy cycles per page load.
 *
 * The probe is intentionally conservative: any rejection from `factory.create`
 * is interpreted as "not supported" rather than letting the exception
 * propagate, because the alternative — surfacing transient failures into
 * capability inference — would flip declared capabilities mid-session.
 *
 * Both probes immediately `destroy()` the smoke-tested session so we don't
 * keep a model loaded just to satisfy feature detection.
 *
 * @param factory Optional injected factory for tests. Defaults to the real
 *                `LanguageModel` global when present.
 */
export function probeWebBrowserCapabilities(
  factory?: WebBrowserProbeFactory
): Promise<WebBrowserProbedCapabilities> {
  if (probePromise) return probePromise;

  probePromise = (async (): Promise<WebBrowserProbedCapabilities> => {
    let resolvedFactory: WebBrowserProbeFactory | undefined = factory;
    if (!resolvedFactory) {
      // Lazy-resolve the real global through getApi which surfaces a
      // consistent error if `LanguageModel` is missing. We catch and treat
      // "missing" as "no capabilities".
      try {
        // The ambient `LanguageModel` global may be undefined outside Chrome.

        const lm = (
          typeof (globalThis as any).LanguageModel !== "undefined"
            ? (globalThis as any).LanguageModel
            : undefined
        ) as WebBrowserProbeFactory | undefined;
        resolvedFactory = getApi("LanguageModel", lm);
      } catch {
        return CONSERVATIVE_PROBED_CAPABILITIES;
      }
    }

    // Prefer `LanguageModel.params()` if exposed: it's the cheapest signal.
    // Today the spec params surface doesn't actually report json/tool flags
    // (only topK/temperature) so this is a forward-compat hook. If the
    // method exists and resolves we still fall through to smoke-tests for
    // the actual feature gates.
    if (typeof resolvedFactory.params === "function") {
      try {
        await resolvedFactory.params();
      } catch {
        // Non-fatal — params() restricted to extensions and may reject on web.
      }
    }

    const jsonMode = await probeOption(resolvedFactory, {
      responseConstraint: { type: "object" },
    });
    const toolUse = await probeOption(resolvedFactory, {
      tools: [
        {
          name: "_probe",
          description: "",
          inputSchema: { type: "object" },
          execute: async (): Promise<string> => "",
        },
      ],
    });

    return { jsonMode, toolUse };
  })();

  return probePromise;
}

/**
 * Issue a smoke-test `factory.create(options)`. Any rejection means the
 * option is unsupported in this Chrome build. On success we immediately
 * `destroy()` the session — its only purpose was to confirm acceptance.
 */
async function probeOption(
  factory: WebBrowserProbeFactory,
  options: Record<string, unknown>
): Promise<boolean> {
  try {
    const session = await factory.create(options);
    try {
      session.destroy();
    } catch {
      // best-effort: destroy failures don't affect the probe outcome
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * @internal Test-only escape hatch to clear the coalescing cache between
 * test cases. Production code never resets the probe — the result is
 * stable for the lifetime of the page.
 */
export function _resetProbeCache(): void {
  probePromise = undefined;
}
