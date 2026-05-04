/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP OAuth provider adapter backed by ICredentialStore, and factory function.
 */

import {
  ClientCredentialsProvider,
  PrivateKeyJwtProvider,
  StaticPrivateKeyJwtProvider,
  createPrivateKeyJwtAuth,
} from "@modelcontextprotocol/sdk/client/auth-extensions.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AddClientAuthentication,
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";

export { UnauthorizedError };
export type { OAuthClientProvider };
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getGlobalCredentialStore } from "@workglow/util";
import type { ICredentialStore } from "@workglow/util";
import type { McpAuthConfig } from "./McpAuthTypes";

// ── Key helpers ────────────────────────────────────────────────────────

function normalizeServerUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    // Strip trailing slash for consistent keying
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return serverUrl;
  }
}

function storeKey(serverUrl: string, suffix: string): string {
  return `mcp:oauth:${normalizeServerUrl(serverUrl)}:${suffix}`;
}

// ── CredentialStoreOAuthProvider ────────────────────────────────────────

/**
 * OAuthClientProvider backed by ICredentialStore.
 *
 * Stores tokens, client info, code verifiers, and discovery state as JSON
 * strings under namespaced keys. Enables token persistence across
 * short-lived MCP connections that share the same server URL.
 */
export class CredentialStoreOAuthProvider implements OAuthClientProvider {
  private readonly store: ICredentialStore;
  private readonly serverUrl: string;
  private readonly _clientMetadata: OAuthClientMetadata;
  private readonly _redirectUrl: string | URL | undefined;
  private readonly _initialClientInfo: OAuthClientInformationMixed | undefined;

  /** Optional override for grant-specific token request preparation. */
  prepareTokenRequest?: (
    scope?: string
  ) => URLSearchParams | Promise<URLSearchParams | undefined> | undefined;

  /** Optional override for custom client authentication on token requests. */
  addClientAuthentication?: AddClientAuthentication;

  constructor(options: {
    store: ICredentialStore;
    serverUrl: string;
    clientMetadata: OAuthClientMetadata;
    redirectUrl?: string | URL;
    initialClientInfo?: OAuthClientInformationMixed;
    prepareTokenRequest?: OAuthClientProvider["prepareTokenRequest"];
    addClientAuthentication?: AddClientAuthentication;
  }) {
    this.store = options.store;
    this.serverUrl = options.serverUrl;
    this._clientMetadata = options.clientMetadata;
    this._redirectUrl = options.redirectUrl;
    this._initialClientInfo = options.initialClientInfo;
    if (options.prepareTokenRequest) {
      this.prepareTokenRequest = options.prepareTokenRequest;
    }
    if (options.addClientAuthentication) {
      this.addClientAuthentication = options.addClientAuthentication;
    }
  }

  // ── Properties ─────────────────────────────────────────────────────

  get redirectUrl(): string | URL | undefined {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  // ── Client information ─────────────────────────────────────────────

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const raw = await this.store.get(storeKey(this.serverUrl, "client_info"));
    if (!raw) return this._initialClientInfo;
    return JSON.parse(raw) as OAuthClientInformationMixed;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.store.put(storeKey(this.serverUrl, "client_info"), JSON.stringify(info));
  }

  // ── Tokens ─────────────────────────────────────────────────────────

  async tokens(): Promise<OAuthTokens | undefined> {
    const raw = await this.store.get(storeKey(this.serverUrl, "tokens"));
    if (!raw) return undefined;
    return JSON.parse(raw) as OAuthTokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const expiresAt =
      tokens.expires_in != null ? new Date(Date.now() + tokens.expires_in * 1000) : undefined;
    await this.store.put(storeKey(this.serverUrl, "tokens"), JSON.stringify(tokens), {
      expiresAt,
    });
  }

  // ── Authorization redirect ─────────────────────────────────────────

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Non-interactive environments cannot redirect a browser. Throw with
    // the URL so the host application can handle it (e.g., open a browser).
    throw new Error(
      `MCP OAuth authorization required. ` +
        `Open this URL to authorize: ${authorizationUrl.toString()}`
    );
  }

  // ── PKCE code verifier ─────────────────────────────────────────────

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.put(storeKey(this.serverUrl, "code_verifier"), codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const v = await this.store.get(storeKey(this.serverUrl, "code_verifier"));
    if (!v) throw new Error("No code verifier saved for this session");
    return v;
  }

  // ── Discovery state ────────────────────────────────────────────────

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.store.put(storeKey(this.serverUrl, "discovery"), JSON.stringify(state));
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const raw = await this.store.get(storeKey(this.serverUrl, "discovery"));
    if (!raw) return undefined;
    return JSON.parse(raw) as OAuthDiscoveryState;
  }

  // ── Credential invalidation ────────────────────────────────────────

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery"
  ): Promise<void> {
    const deleteKey = async (suffix: string) => {
      await this.store.delete(storeKey(this.serverUrl, suffix));
    };

    switch (scope) {
      case "all":
        await deleteKey("tokens");
        await deleteKey("client_info");
        await deleteKey("code_verifier");
        await deleteKey("discovery");
        break;
      case "client":
        await deleteKey("client_info");
        break;
      case "tokens":
        await deleteKey("tokens");
        break;
      case "verifier":
        await deleteKey("code_verifier");
        break;
      case "discovery":
        await deleteKey("discovery");
        break;
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Creates an OAuthClientProvider for the given auth config, or returns
 * `undefined` when no provider is needed (none / bearer).
 *
 * Bearer auth is handled at the transport level via request headers,
 * so this function returns `undefined` for it.
 */
export function createAuthProvider(
  auth: McpAuthConfig,
  serverUrl: string,
  credentialStore?: ICredentialStore
): OAuthClientProvider | undefined {
  switch (auth.type) {
    case "none":
    case "bearer":
      return undefined;

    case "client_credentials": {
      if (!credentialStore) {
        // Fallback to SDK's built-in provider (no persistence)
        return new ClientCredentialsProvider({
          clientId: auth.client_id,
          clientSecret: auth.client_secret,
          clientName: auth.client_name,
          scope: auth.scope,
        });
      }

      const prepareTokenRequest = (scope?: string): URLSearchParams => {
        const params = new URLSearchParams({ grant_type: "client_credentials" });
        const effectiveScope = scope ?? auth.scope;
        if (effectiveScope) params.set("scope", effectiveScope);
        return params;
      };

      return new CredentialStoreOAuthProvider({
        store: credentialStore,
        serverUrl,
        clientMetadata: {
          redirect_uris: [],
          grant_types: ["client_credentials"],
          token_endpoint_auth_method: "client_secret_basic",
          client_name: auth.client_name,
        },
        initialClientInfo: {
          client_id: auth.client_id,
          client_secret: auth.client_secret,
        },
        prepareTokenRequest,
      });
    }

    case "private_key_jwt": {
      if (!credentialStore) {
        return new PrivateKeyJwtProvider({
          clientId: auth.client_id,
          privateKey: auth.private_key,
          algorithm: auth.algorithm,
          clientName: auth.client_name,
          jwtLifetimeSeconds: auth.jwt_lifetime_seconds,
          scope: auth.scope,
        });
      }

      const addClientAuth = createPrivateKeyJwtAuth({
        issuer: auth.client_id,
        subject: auth.client_id,
        privateKey: auth.private_key,
        alg: auth.algorithm,
        lifetimeSeconds: auth.jwt_lifetime_seconds,
      });

      const prepareTokenRequest = (scope?: string): URLSearchParams => {
        const params = new URLSearchParams({ grant_type: "client_credentials" });
        const effectiveScope = scope ?? auth.scope;
        if (effectiveScope) params.set("scope", effectiveScope);
        return params;
      };

      return new CredentialStoreOAuthProvider({
        store: credentialStore,
        serverUrl,
        clientMetadata: {
          redirect_uris: [],
          grant_types: ["client_credentials"],
          token_endpoint_auth_method: "private_key_jwt",
          client_name: auth.client_name,
        },
        initialClientInfo: { client_id: auth.client_id },
        prepareTokenRequest,
        addClientAuthentication: addClientAuth,
      });
    }

    case "static_private_key_jwt": {
      if (!credentialStore) {
        return new StaticPrivateKeyJwtProvider({
          clientId: auth.client_id,
          jwtBearerAssertion: auth.jwt_bearer_assertion,
          clientName: auth.client_name,
          scope: auth.scope,
        });
      }

      const assertion = auth.jwt_bearer_assertion;
      const addClientAuth: AddClientAuthentication = (_headers, params) => {
        params.set(
          "client_assertion_type",
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
        );
        params.set("client_assertion", assertion);
      };

      const prepareTokenRequest = (scope?: string): URLSearchParams => {
        const params = new URLSearchParams({ grant_type: "client_credentials" });
        const effectiveScope = scope ?? auth.scope;
        if (effectiveScope) params.set("scope", effectiveScope);
        return params;
      };

      return new CredentialStoreOAuthProvider({
        store: credentialStore,
        serverUrl,
        clientMetadata: {
          redirect_uris: [],
          grant_types: ["client_credentials"],
          token_endpoint_auth_method: "private_key_jwt",
          client_name: auth.client_name,
        },
        initialClientInfo: { client_id: auth.client_id },
        prepareTokenRequest,
        addClientAuthentication: addClientAuth,
      });
    }

    case "authorization_code": {
      if (!credentialStore) {
        throw new Error(
          "authorization_code auth requires a credential store for token persistence"
        );
      }

      return new CredentialStoreOAuthProvider({
        store: credentialStore,
        serverUrl,
        clientMetadata: {
          redirect_uris: [auth.redirect_url] as string[],
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: auth.client_secret ? "client_secret_basic" : "none",
          scope: auth.scope,
        },
        initialClientInfo: {
          client_id: auth.client_id,
          ...(auth.client_secret ? { client_secret: auth.client_secret } : {}),
        },
        redirectUrl: auth.redirect_url,
      });
    }

    default:
      return undefined;
  }
}

// ── Credential resolution ──────────────────────────────────────────────

/**
 * Resolves credential-store keys in auth config to actual secret values.
 *
 * This is needed for the standalone MCP task path where config properties
 * are NOT auto-resolved by `resolveSchemaInputs`. For the AgentTask path,
 * credential resolution happens automatically via `format: "credential"`.
 */
export async function resolveAuthSecrets(
  auth: McpAuthConfig,
  credentialStore?: ICredentialStore
): Promise<McpAuthConfig> {
  if (auth.type === "none") return auth;

  const store = credentialStore ?? getGlobalCredentialStore();

  async function resolve(value: string | undefined): Promise<string | undefined> {
    if (!value) return value;
    const resolved = await store.get(value);
    // If the store returns a value, use it; otherwise keep the original
    // (it may be a literal secret, not a key).
    return resolved ?? value;
  }

  switch (auth.type) {
    case "bearer":
      return { ...auth, token: (await resolve(auth.token)) ?? auth.token };

    case "client_credentials":
      return {
        ...auth,
        client_secret: (await resolve(auth.client_secret)) ?? auth.client_secret,
      };

    case "private_key_jwt":
      return {
        ...auth,
        private_key: (await resolve(auth.private_key)) ?? auth.private_key,
      };

    case "static_private_key_jwt":
      return {
        ...auth,
        jwt_bearer_assertion:
          (await resolve(auth.jwt_bearer_assertion)) ?? auth.jwt_bearer_assertion,
      };

    case "authorization_code":
      return {
        ...auth,
        client_secret: await resolve(auth.client_secret),
      };

    default:
      return auth;
  }
}
