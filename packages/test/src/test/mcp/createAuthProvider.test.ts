/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpAuthConfig } from "@workglow/mcp/util";
import {
  createAuthProvider,
  CredentialStoreOAuthProvider,
  resolveAuthSecrets,
} from "@workglow/mcp/util";
import { InMemoryCredentialStore, MissingCredentialError } from "@workglow/util";
import { describe, expect, it } from "vitest";

const SERVER_URL = "https://mcp.example.com/api";

describe("createAuthProvider", () => {
  describe("none", () => {
    it("returns undefined", () => {
      const result = createAuthProvider({ type: "none" }, SERVER_URL);
      expect(result).toBeUndefined();
    });
  });

  describe("bearer", () => {
    it("returns undefined (handled at transport level)", () => {
      const result = createAuthProvider({ type: "bearer", token: "my-token" }, SERVER_URL);
      expect(result).toBeUndefined();
    });
  });

  describe("client_credentials", () => {
    it("returns SDK provider when no credential store", () => {
      const result = createAuthProvider(
        {
          type: "client_credentials",
          client_id: "cid",
          client_secret: "cs",
        },
        SERVER_URL
      );
      // SDK's ClientCredentialsProvider (not our CredentialStoreOAuthProvider)
      expect(result).toBeDefined();
      expect(result).not.toBeInstanceOf(CredentialStoreOAuthProvider);
    });

    it("returns CredentialStoreOAuthProvider when credential store provided", () => {
      const store = new InMemoryCredentialStore();
      const result = createAuthProvider(
        {
          type: "client_credentials",
          client_id: "cid",
          client_secret: "cs",
        },
        SERVER_URL,
        store
      );
      expect(result).toBeInstanceOf(CredentialStoreOAuthProvider);
    });

    it("CredentialStoreOAuthProvider has prepareTokenRequest for client_credentials", () => {
      const store = new InMemoryCredentialStore();
      const result = createAuthProvider(
        {
          type: "client_credentials",
          client_id: "cid",
          client_secret: "cs",
          scope: "read write",
        },
        SERVER_URL,
        store
      ) as CredentialStoreOAuthProvider;

      expect(result.prepareTokenRequest).toBeDefined();
      const params = result.prepareTokenRequest!() as URLSearchParams;
      expect(params.get("grant_type")).toBe("client_credentials");
      expect(params.get("scope")).toBe("read write");
    });
  });

  describe("static_private_key_jwt", () => {
    it("returns SDK provider when no credential store", () => {
      const result = createAuthProvider(
        {
          type: "static_private_key_jwt",
          client_id: "cid",
          jwt_bearer_assertion: "jwt.token.here",
        },
        SERVER_URL
      );
      expect(result).toBeDefined();
      expect(result).not.toBeInstanceOf(CredentialStoreOAuthProvider);
    });

    it("returns CredentialStoreOAuthProvider with credential store", () => {
      const store = new InMemoryCredentialStore();
      const result = createAuthProvider(
        {
          type: "static_private_key_jwt",
          client_id: "cid",
          jwt_bearer_assertion: "jwt.token.here",
        },
        SERVER_URL,
        store
      );
      expect(result).toBeInstanceOf(CredentialStoreOAuthProvider);
    });
  });

  describe("authorization_code", () => {
    it("throws without credential store", () => {
      expect(() =>
        createAuthProvider(
          {
            type: "authorization_code",
            client_id: "cid",
            redirect_url: "https://app.example.com/callback",
          },
          SERVER_URL
        )
      ).toThrow("credential store");
    });

    it("returns CredentialStoreOAuthProvider with credential store", () => {
      const store = new InMemoryCredentialStore();
      const result = createAuthProvider(
        {
          type: "authorization_code",
          client_id: "cid",
          redirect_url: "https://app.example.com/callback",
        },
        SERVER_URL,
        store
      );
      expect(result).toBeInstanceOf(CredentialStoreOAuthProvider);
      expect(result!.redirectUrl).toBe("https://app.example.com/callback");
    });
  });
});

describe("resolveAuthSecrets", () => {
  it("returns none config as-is", async () => {
    const config: McpAuthConfig = { type: "none" };
    expect(await resolveAuthSecrets(config)).toEqual(config);
  });

  it("resolves bearer token from credential store", async () => {
    const store = new InMemoryCredentialStore();
    await store.put("my-api-key", "actual-secret-value");

    const config: McpAuthConfig = { type: "bearer", token: "my-api-key" };
    const resolved = await resolveAuthSecrets(config, store);
    expect(resolved).toEqual({ type: "bearer", token: "actual-secret-value" });
  });

  it("throws MissingCredentialError when an explicit store is passed and the key is absent", async () => {
    const store = new InMemoryCredentialStore();
    const calls: string[] = [];
    const recorderGet = store.get.bind(store);
    store.get = async (k: string) => {
      calls.push(k);
      return recorderGet(k);
    };

    const config: McpAuthConfig = { type: "bearer", token: "sk-missing-key" };
    await expect(resolveAuthSecrets(config, store)).rejects.toBeInstanceOf(MissingCredentialError);

    // The literal credential-key name must not be returned anywhere as a bearer:
    // the call site recorded only the lookup; the literal key never flowed back
    // into a resolved config.
    expect(calls).toContain("sk-missing-key");
  });

  it("falls back to literal value when no store argument is provided (legacy)", async () => {
    const config: McpAuthConfig = { type: "bearer", token: "sk-literal-key" };
    const resolved = await resolveAuthSecrets(config);
    expect(resolved).toEqual({ type: "bearer", token: "sk-literal-key" });
  });

  it("falls back to literal value when explicit strict:false is opted into", async () => {
    const store = new InMemoryCredentialStore();
    const config: McpAuthConfig = { type: "bearer", token: "sk-literal-key" };
    const resolved = await resolveAuthSecrets(config, store, { strict: false });
    expect(resolved).toEqual({ type: "bearer", token: "sk-literal-key" });
  });

  it("MissingCredentialError message does not leak the resolved value (key only)", async () => {
    const store = new InMemoryCredentialStore();
    const config: McpAuthConfig = { type: "bearer", token: "AUTH_KEY_NAME" };
    try {
      await resolveAuthSecrets(config, store);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingCredentialError);
      const err = e as MissingCredentialError;
      expect(err.key).toBe("AUTH_KEY_NAME");
      expect(err.message).toContain("AUTH_KEY_NAME");
      expect(err.message).not.toMatch(/Bearer/i);
    }
  });

  it("resolves client_secret for client_credentials", async () => {
    const store = new InMemoryCredentialStore();
    await store.put("oauth-secret", "resolved-secret");

    const config: McpAuthConfig = {
      type: "client_credentials",
      client_id: "cid",
      client_secret: "oauth-secret",
    };
    const resolved = await resolveAuthSecrets(config, store);
    expect(resolved.type === "client_credentials" && resolved.client_secret).toBe(
      "resolved-secret"
    );
  });

  it("resolves private_key for private_key_jwt", async () => {
    const store = new InMemoryCredentialStore();
    await store.put("pk-key", "-----BEGIN PRIVATE KEY-----\n...");

    const config: McpAuthConfig = {
      type: "private_key_jwt",
      client_id: "cid",
      private_key: "pk-key",
      algorithm: "RS256",
    };
    const resolved = await resolveAuthSecrets(config, store);
    expect(resolved.type === "private_key_jwt" && resolved.private_key).toBe(
      "-----BEGIN PRIVATE KEY-----\n..."
    );
  });

  it("resolves jwt_bearer_assertion for static_private_key_jwt", async () => {
    const store = new InMemoryCredentialStore();
    await store.put("jwt-key", "eyJhbGci...");

    const config: McpAuthConfig = {
      type: "static_private_key_jwt",
      client_id: "cid",
      jwt_bearer_assertion: "jwt-key",
    };
    const resolved = await resolveAuthSecrets(config, store);
    expect(resolved.type === "static_private_key_jwt" && resolved.jwt_bearer_assertion).toBe(
      "eyJhbGci..."
    );
  });
});
