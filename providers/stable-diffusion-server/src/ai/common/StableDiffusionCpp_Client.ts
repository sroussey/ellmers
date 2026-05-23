/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IBackendsTransport, IRunningHandle } from "@workglow/ai/provider-utils";
import type { StableDiffusionCppModelConfig } from "./StableDiffusionCpp_ModelSchema";

/**
 * Endpoint variants for stable-diffusion.cpp HTTP servers. Default `/txt2img`
 * matches the conventional sd.cpp HTTP API; `/v1/images/generations` is used
 * by OpenAI-compatible builds.
 */
export type StableDiffusionCppEndpoint = "/txt2img" | "/v1/images/generations";

/**
 * Provider-construction options shared across registrations.
 *
 * `transport` and `externalUrl` are both optional, but the resolver throws
 * at acquisition time if no URL source resolves for a given request.
 */
export interface IStableDiffusionCppProviderOptions {
  readonly transport?: IBackendsTransport;
  readonly externalUrl?: string;
  /** Default endpoint used when neither the model nor the request overrides it. */
  readonly endpoint?: StableDiffusionCppEndpoint;
}

/** Resolved base URL plus a release callback (no-op for externalUrl paths). */
export interface IAcquiredBaseUrl {
  readonly baseUrl: string;
  readonly release: () => Promise<void>;
}

/**
 * Resolve a base URL for one request.
 *
 * Precedence:
 *   1. `model.provider_config.base_url`
 *   2. `opts.externalUrl`
 *   3. `opts.transport.ensureRunning({ ... })` — requires `provider_config.model_path`
 *
 * Throws with a clear message if none of the three resolves.
 */
export async function acquireBaseUrl(
  model: StableDiffusionCppModelConfig | undefined,
  opts: IStableDiffusionCppProviderOptions
): Promise<IAcquiredBaseUrl> {
  const modelBaseUrl = model?.provider_config?.base_url;
  if (typeof modelBaseUrl === "string" && modelBaseUrl.length > 0) {
    return { baseUrl: stripTrailingSlash(modelBaseUrl), release: noopRelease };
  }
  if (typeof opts.externalUrl === "string" && opts.externalUrl.length > 0) {
    return { baseUrl: stripTrailingSlash(opts.externalUrl), release: noopRelease };
  }
  if (opts.transport) {
    const modelPath = model?.provider_config?.model_path;
    if (typeof modelPath !== "string" || modelPath.length === 0) {
      throw new Error(
        "StableDiffusionCpp: transport-mode acquisition requires provider_config.model_path."
      );
    }
    const handle: IRunningHandle = await opts.transport.ensureRunning({
      backend: "stable-diffusion-server",
      modelPath,
      opts: {},
    });
    return {
      baseUrl: stripTrailingSlash(handle.url),
      release: () => handle.release(),
    };
  }
  throw new Error(
    "StableDiffusionCpp: no base URL source — set provider_config.base_url, opts.externalUrl, or opts.transport."
  );
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

const noopRelease = async (): Promise<void> => {};

// ── Base64 PNG helpers ─────────────────────────────────────────────────────

/**
 * Decodes a base64-encoded PNG string to bytes platform-neutrally.
 * Avoids Node-only `Buffer.from(...)` so the provider stays runtime-agnostic.
 */
export function decodeBase64Png(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encodes raw bytes to a base64 string platform-neutrally.
 * Used for `image.editing` to send the source image as a base64 PNG.
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Process in chunks to avoid blowing the call stack for large images.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
    );
  }
  return btoa(binary);
}
