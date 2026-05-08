/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared cloud-provider client utilities: API-key resolution and lazy SDK
 * loading. Used by each provider's `*_Client.ts` so the same fallback chain
 * (provider_config → env var) and the same "package missing" error message
 * live in one place.
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
 * Dynamically import a provider SDK package, throwing a uniform install hint
 * if the package isn't present.
 */
export async function loadProviderSdk<T = unknown>(
  packageName: string,
  friendlyName?: string
): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ packageName)) as T;
  } catch {
    const label = friendlyName ?? packageName;
    throw new Error(
      `${packageName} is required for ${label} tasks. Install it with: bun add ${packageName}`
    );
  }
}

/**
 * True when running inside a browser-like environment (window/worker globals
 * present). Cloud SDKs use this to set their `dangerouslyAllowBrowser` flag.
 */
export function isBrowserLike(): boolean {
  return typeof globalThis.document !== "undefined" || "WorkerGlobalScope" in globalThis;
}
