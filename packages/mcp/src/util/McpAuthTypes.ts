/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared MCP authentication type definitions and JSON Schema.
 */

/**
 * Supported MCP authentication types.
 */
export const mcpAuthTypes = [
  "none",
  "bearer",
  "client_credentials",
  "private_key_jwt",
  "static_private_key_jwt",
  "authorization_code",
] as const;

export type McpAuthType = (typeof mcpAuthTypes)[number];

// ── Discriminated union on `type` ──────────────────────────────────────

export interface McpAuthNone {
  readonly type: "none";
}

export interface McpAuthBearer {
  readonly type: "bearer";
  /** Static token or credential-store key (format: "credential"). */
  readonly token: string;
}

export interface McpAuthClientCredentials {
  readonly type: "client_credentials";
  readonly client_id: string;
  /** Client secret or credential-store key (format: "credential"). */
  readonly client_secret: string;
  readonly client_name?: string;
  readonly scope?: string;
}

export interface McpAuthPrivateKeyJwt {
  readonly type: "private_key_jwt";
  readonly client_id: string;
  /** PEM / JWK private key or credential-store key (format: "credential"). */
  readonly private_key: string;
  readonly algorithm: string;
  readonly client_name?: string;
  readonly jwt_lifetime_seconds?: number;
  readonly scope?: string;
}

export interface McpAuthStaticPrivateKeyJwt {
  readonly type: "static_private_key_jwt";
  readonly client_id: string;
  /** Pre-built JWT assertion or credential-store key (format: "credential"). */
  readonly jwt_bearer_assertion: string;
  readonly client_name?: string;
  readonly scope?: string;
}

export interface McpAuthAuthorizationCode {
  readonly type: "authorization_code";
  readonly client_id: string;
  readonly client_secret?: string;
  readonly redirect_url: string;
  readonly scope?: string;
}

export type McpAuthConfig =
  | McpAuthNone
  | McpAuthBearer
  | McpAuthClientCredentials
  | McpAuthPrivateKeyJwt
  | McpAuthStaticPrivateKeyJwt
  | McpAuthAuthorizationCode;

// ── JSON Schema for auth config (discriminated union on auth_type) ─────

export const mcpAuthConfigSchema = {
  properties: {
    auth_type: {
      type: "string",
      enum: mcpAuthTypes,
      title: "Auth Type",
      description: "Authentication method for connecting to the MCP server",
    },
    auth_token: {
      type: "string",
      format: "credential",
      title: "Bearer Token",
      description: "Static bearer token or API key (for bearer auth)",
    },
    auth_client_id: {
      type: "string",
      title: "Client ID",
      description: "OAuth client ID (for OAuth auth types)",
    },
    auth_client_secret: {
      type: "string",
      format: "credential",
      title: "Client Secret",
      description: "OAuth client secret (for client_credentials auth)",
    },
    auth_private_key: {
      type: "string",
      format: "credential",
      title: "Private Key",
      description: "PEM or JWK private key (for private_key_jwt auth)",
    },
    auth_algorithm: {
      type: "string",
      title: "Algorithm",
      description: "JWT signing algorithm, e.g. RS256, ES256 (for private_key_jwt auth)",
    },
    auth_jwt_bearer_assertion: {
      type: "string",
      format: "credential",
      title: "JWT Assertion",
      description: "Pre-built JWT assertion (for static_private_key_jwt auth)",
    },
    auth_redirect_url: {
      type: "string",
      format: "uri",
      title: "Redirect URL",
      description: "OAuth redirect URL (for authorization_code auth)",
    },
    auth_scope: {
      type: "string",
      title: "Scope",
      description: "OAuth scope (space-separated)",
    },
    auth_client_name: {
      type: "string",
      title: "Client Name",
      description: "Optional OAuth client display name",
    },
    auth_jwt_lifetime_seconds: {
      type: "number",
      title: "JWT Lifetime",
      description: "JWT lifetime in seconds (default: 300)",
      minimum: 1,
    },
  },
  allOf: [
    {
      if: { properties: { auth_type: { const: "bearer" } }, required: ["auth_type"] },
      then: {
        required: ["auth_token"],
        properties: { auth_token: true },
      },
    },
    {
      if: {
        properties: { auth_type: { const: "client_credentials" } },
        required: ["auth_type"],
      },
      then: {
        required: ["auth_client_id", "auth_client_secret"],
        properties: {
          auth_client_id: true,
          auth_client_secret: true,
          auth_client_name: true,
          auth_scope: true,
        },
      },
    },
    {
      if: { properties: { auth_type: { const: "private_key_jwt" } }, required: ["auth_type"] },
      then: {
        required: ["auth_client_id", "auth_private_key", "auth_algorithm"],
        properties: {
          auth_client_id: true,
          auth_private_key: true,
          auth_algorithm: true,
          auth_client_name: true,
          auth_jwt_lifetime_seconds: true,
          auth_scope: true,
        },
      },
    },
    {
      if: {
        properties: { auth_type: { const: "static_private_key_jwt" } },
        required: ["auth_type"],
      },
      then: {
        required: ["auth_client_id", "auth_jwt_bearer_assertion"],
        properties: {
          auth_client_id: true,
          auth_jwt_bearer_assertion: true,
          auth_client_name: true,
          auth_scope: true,
        },
      },
    },
    {
      if: { properties: { auth_type: { const: "authorization_code" } }, required: ["auth_type"] },
      then: {
        required: ["auth_client_id", "auth_redirect_url"],
        properties: {
          auth_client_id: true,
          auth_client_secret: true,
          auth_redirect_url: true,
          auth_scope: true,
        },
      },
    },
  ],
} as const;

/**
 * Runtime type guard for McpAuthType.
 */
function isMcpAuthType(value: unknown): value is McpAuthType {
  return typeof value === "string" && (mcpAuthTypes as readonly string[]).includes(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Constructs a typed McpAuthConfig from flat schema properties.
 * Used by `createMcpClient()` to normalize the config.
 * Returns `undefined` if required fields for the selected auth type are missing.
 */
export function buildAuthConfig(flat: Record<string, unknown>): McpAuthConfig | undefined {
  const rawAuthType = flat.auth_type;

  if (!isMcpAuthType(rawAuthType) || rawAuthType === "none") {
    return undefined;
  }

  const authType: McpAuthType = rawAuthType;

  switch (authType) {
    case "bearer": {
      const token = asNonEmptyString(flat.auth_token);
      if (!token) return undefined;
      return { type: "bearer", token };
    }
    case "client_credentials": {
      const client_id = asNonEmptyString(flat.auth_client_id);
      const client_secret = asNonEmptyString(flat.auth_client_secret);
      if (!client_id || !client_secret) return undefined;
      return {
        type: "client_credentials",
        client_id,
        client_secret,
        client_name: asNonEmptyString(flat.auth_client_name),
        scope: asNonEmptyString(flat.auth_scope),
      };
    }
    case "private_key_jwt": {
      const client_id = asNonEmptyString(flat.auth_client_id);
      const private_key = asNonEmptyString(flat.auth_private_key);
      const algorithm = asNonEmptyString(flat.auth_algorithm);
      if (!client_id || !private_key || !algorithm) return undefined;
      return {
        type: "private_key_jwt",
        client_id,
        private_key,
        algorithm,
        client_name: asNonEmptyString(flat.auth_client_name),
        jwt_lifetime_seconds: asNumber(flat.auth_jwt_lifetime_seconds),
        scope: asNonEmptyString(flat.auth_scope),
      };
    }
    case "static_private_key_jwt": {
      const client_id = asNonEmptyString(flat.auth_client_id);
      const jwt_bearer_assertion = asNonEmptyString(flat.auth_jwt_bearer_assertion);
      if (!client_id || !jwt_bearer_assertion) return undefined;
      return {
        type: "static_private_key_jwt",
        client_id,
        jwt_bearer_assertion,
        client_name: asNonEmptyString(flat.auth_client_name),
        scope: asNonEmptyString(flat.auth_scope),
      };
    }
    case "authorization_code": {
      const client_id = asNonEmptyString(flat.auth_client_id);
      const redirect_url = asNonEmptyString(flat.auth_redirect_url);
      if (!client_id || !redirect_url) return undefined;
      return {
        type: "authorization_code",
        client_id,
        client_secret: asNonEmptyString(flat.auth_client_secret),
        redirect_url,
        scope: asNonEmptyString(flat.auth_scope),
      };
    }
    default:
      return undefined;
  }
}
