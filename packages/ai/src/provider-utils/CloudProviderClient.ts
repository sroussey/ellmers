/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared cloud-provider client utilities: API-key resolution and browser-env
 * detection. Used by each provider's `*_Client.ts` so the same fallback chain
 * (provider_config → env var) lives in one place.
 */

export interface CloudCredentialConfig {
  readonly credential_key?: string;
  readonly api_key?: string;
}

export interface ResolveApiKeyArgs {
  readonly config: CloudCredentialConfig | undefined;
  /** Single env var name, or list of alternatives tried in order. */
  readonly envVar: string | readonly string[];
  /** Human-friendly provider label used in the error message. */
  readonly providerLabel: string;
}

/**
 * Resolve the API key for a cloud provider.
 *
 * Looks at `config.credential_key`, then `config.api_key`, then each entry in
 * `envVar` (in order). Throws a uniform error if nothing is found.
 */
export function resolveApiKey(args: ResolveApiKeyArgs): string {
  const fromConfig = args.config?.credential_key || args.config?.api_key;
  if (fromConfig) return fromConfig;

  const envVars = typeof args.envVar === "string" ? [args.envVar] : args.envVar;
  if (typeof process !== "undefined") {
    for (const name of envVars) {
      const v = process.env?.[name];
      if (v) return v;
    }
  }

  const envList = envVars.join(" / ");
  throw new Error(
    `Missing ${args.providerLabel} API key: set provider_config.credential_key or the ${envList} environment variable.`
  );
}

/**
 * True when running inside a browser-like environment (window/worker globals
 * present). Cloud SDKs use this to set their `dangerouslyAllowBrowser` flag.
 */
export function isBrowserLike(): boolean {
  return typeof globalThis.document !== "undefined" || "WorkerGlobalScope" in globalThis;
}

export interface ValidateProviderBaseUrlArgs {
  /** Discriminator used only for error messages. */
  readonly vendor: "openai" | "anthropic";
  /**
   * Allow-list of acceptable hostnames or hostname suffixes. A hostname
   * matches if it is equal to the entry or ends with the entry (so
   * `.openai.azure.com` matches any subdomain of `openai.azure.com`).
   */
  readonly allowHosts: readonly string[];
  /**
   * When `true`, the caller has explicitly opted out of host validation
   * (e.g. an enterprise gateway with a custom domain). The URL still has
   * to parse and use a safe scheme.
   */
  readonly trustedBaseUrl?: boolean;
  /** Human-friendly provider label used in error messages. */
  readonly providerLabel: string;
}

/**
 * Validate a provider `base_url` before handing it to the SDK.
 *
 * Cloud SDKs send the API key in `Authorization: Bearer` to whatever
 * `baseURL` they are constructed with. In multi-tenant scenarios
 * (marketplace model definitions, workflow imports) an attacker can
 * exfiltrate the key by pointing `base_url` at their own server. This
 * helper enforces two defenses before construction:
 *
 *   - The URL must parse and use HTTPS (HTTP is allowed only for
 *     `localhost` / `127.0.0.1`, where the request never leaves the
 *     machine and is presumed to be a local gateway).
 *   - The hostname must match an entry in {@link ValidateProviderBaseUrlArgs.allowHosts}
 *     by exact equality or by suffix (so subdomains of e.g. `openai.azure.com`
 *     are permitted), unless the model is explicitly flagged as
 *     `trustedBaseUrl`.
 *
 * Returns the normalized string form. Returns `undefined` for an empty /
 * undefined input so the SDK falls back to its default base URL.
 *
 * @throws when the URL fails to parse, uses an unsafe scheme, or points
 *   at a non-allow-listed host without `trustedBaseUrl`.
 */
export function validateProviderBaseUrl(
  baseUrl: string | undefined,
  opts: ValidateProviderBaseUrlArgs
): string | undefined {
  if (!baseUrl) return undefined;
  const trimmed = baseUrl.trim();
  if (trimmed === "") return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${opts.providerLabel} provider base_url is not a valid URL: ${trimmed}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new Error(
      `${opts.providerLabel} provider base_url must use https:// (http:// allowed only for localhost): ${trimmed}`
    );
  }

  if (opts.trustedBaseUrl) {
    return parsed.toString();
  }

  const allowed = opts.allowHosts.some((host) => {
    const lower = host.toLowerCase();
    return hostname === lower || hostname.endsWith(lower);
  });
  if (!allowed) {
    throw new Error(
      `${opts.providerLabel} provider base_url host "${hostname}" is not in the allow-list. ` +
        `Set provider_config.trustedBaseUrl = true to opt out of host validation for a known-good custom gateway.`
    );
  }

  return parsed.toString();
}
