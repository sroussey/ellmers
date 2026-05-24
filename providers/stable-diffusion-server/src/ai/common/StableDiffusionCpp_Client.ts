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
    return { baseUrl: normalizeServerBaseUrl(modelBaseUrl), release: noopRelease };
  }
  if (typeof opts.externalUrl === "string" && opts.externalUrl.length > 0) {
    return { baseUrl: normalizeServerBaseUrl(opts.externalUrl), release: noopRelease };
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
      baseUrl: normalizeServerBaseUrl(handle.url),
      release: () => handle.release(),
    };
  }
  throw new Error(
    "StableDiffusionCpp: no base URL source — set provider_config.base_url, opts.externalUrl, or opts.transport."
  );
}

export function normalizeServerBaseUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("StableDiffusionCpp: base URL must be a valid local HTTP(S) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("StableDiffusionCpp: base URL must be a valid local HTTP(S) URL.");
  }
  if (url.username || url.password) {
    throw new Error("StableDiffusionCpp: base URL must not include credentials.");
  }
  if (!isLocalHostname(url.hostname)) {
    throw new Error("StableDiffusionCpp: base URL must target a local HTTP(S) server.");
  }

  url.hash = "";
  url.search = "";
  let pathnameEnd = url.pathname.length;
  while (pathnameEnd > 1 && url.pathname.charCodeAt(pathnameEnd - 1) === 47) {
    pathnameEnd--;
  }
  const pathname = url.pathname.slice(0, pathnameEnd);
  return pathname === "/" ? url.origin : `${url.origin}${pathname}`;
}

export function buildServerUrl(baseUrl: string, endpoint: `/${string}`): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const path = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  return new URL(path, base).toString();
}

function isLocalHostname(hostname: string): boolean {
  const host = removeIpv6Brackets(hostname.toLowerCase());
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  return isLocalIpv4(host) || isLocalIpv6(host);
}

function removeIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isLocalIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (part.length === 0) {
      return false;
    }
    for (const char of part) {
      if (char < "0" || char > "9") {
        return false;
      }
    }
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return false;
    }
    octets.push(octet);
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isLocalIpv6(hostname: string): boolean {
  return (
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  );
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
