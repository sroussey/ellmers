/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { CredentialStoreOAuthProvider } from "@workglow/mcp/util";
import { InMemoryCredentialStore } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

const TEST_SERVER_URL = "https://mcp.example.com/api";
const OTHER_SERVER_URL = "https://other.example.com/api";

const testMetadata: OAuthClientMetadata = {
  redirect_uris: [],
  grant_types: ["client_credentials"],
  client_name: "test-client",
};

describe("CredentialStoreOAuthProvider", () => {
  let store: InMemoryCredentialStore;
  let provider: CredentialStoreOAuthProvider;

  beforeEach(() => {
    store = new InMemoryCredentialStore();
    provider = new CredentialStoreOAuthProvider({
      store,
      serverUrl: TEST_SERVER_URL,
      clientMetadata: testMetadata,
    });
  });

  describe("tokens", () => {
    it("returns undefined when no tokens are stored", async () => {
      expect(await provider.tokens()).toBeUndefined();
    });

    it("stores and retrieves tokens", async () => {
      const tokens: OAuthTokens = {
        access_token: "at-123",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt-456",
      };
      await provider.saveTokens(tokens);

      const retrieved = await provider.tokens();
      expect(retrieved).toEqual(tokens);
    });

    it("stores tokens with expiration metadata", async () => {
      const tokens: OAuthTokens = {
        access_token: "at-123",
        token_type: "Bearer",
        expires_in: 1, // 1 second
      };
      await provider.saveTokens(tokens);

      // Should be available immediately
      expect(await provider.tokens()).toEqual(tokens);
    });
  });

  describe("clientInformation", () => {
    it("returns undefined when no client info stored", async () => {
      expect(await provider.clientInformation()).toBeUndefined();
    });

    it("stores and retrieves client information", async () => {
      const info = { client_id: "cid-123", client_secret: "cs-456" };
      await provider.saveClientInformation(info);

      const retrieved = await provider.clientInformation();
      expect(retrieved).toEqual(info);
    });
  });

  describe("codeVerifier", () => {
    it("throws when no code verifier saved", async () => {
      await expect(provider.codeVerifier()).rejects.toThrow("No code verifier");
    });

    it("stores and retrieves code verifier", async () => {
      await provider.saveCodeVerifier("test-verifier-abc");
      expect(await provider.codeVerifier()).toBe("test-verifier-abc");
    });
  });

  describe("discoveryState", () => {
    it("returns undefined when no state stored", async () => {
      expect(await provider.discoveryState()).toBeUndefined();
    });

    it("stores and retrieves discovery state", async () => {
      const state = {
        authorizationServerUrl: "https://auth.example.com",
        resourceMetadataUrl: "https://mcp.example.com/.well-known/oauth-protected-resource",
      };
      await provider.saveDiscoveryState(state);
      expect(await provider.discoveryState()).toEqual(state);
    });
  });

  describe("redirectToAuthorization", () => {
    it("throws with the authorization URL", async () => {
      const url = new URL("https://auth.example.com/authorize?client_id=test");
      await expect(provider.redirectToAuthorization(url)).rejects.toThrow(
        "MCP OAuth authorization required"
      );
      await expect(provider.redirectToAuthorization(url)).rejects.toThrow(
        "https://auth.example.com/authorize?client_id=test"
      );
    });
  });

  describe("invalidateCredentials", () => {
    async function seedAll() {
      await provider.saveTokens({
        access_token: "at",
        token_type: "Bearer",
      });
      await provider.saveClientInformation({ client_id: "cid" });
      await provider.saveCodeVerifier("cv");
      await provider.saveDiscoveryState({
        authorizationServerUrl: "https://auth.example.com",
      });
    }

    it("invalidates all credentials", async () => {
      await seedAll();
      await provider.invalidateCredentials("all");

      expect(await provider.tokens()).toBeUndefined();
      expect(await provider.clientInformation()).toBeUndefined();
      await expect(provider.codeVerifier()).rejects.toThrow();
      expect(await provider.discoveryState()).toBeUndefined();
    });

    it("invalidates only tokens", async () => {
      await seedAll();
      await provider.invalidateCredentials("tokens");

      expect(await provider.tokens()).toBeUndefined();
      expect(await provider.clientInformation()).toBeDefined();
      expect(await provider.codeVerifier()).toBe("cv");
    });

    it("invalidates only client", async () => {
      await seedAll();
      await provider.invalidateCredentials("client");

      expect(await provider.tokens()).toBeDefined();
      expect(await provider.clientInformation()).toBeUndefined();
    });

    it("invalidates only verifier", async () => {
      await seedAll();
      await provider.invalidateCredentials("verifier");

      expect(await provider.tokens()).toBeDefined();
      await expect(provider.codeVerifier()).rejects.toThrow();
    });

    it("invalidates only discovery", async () => {
      await seedAll();
      await provider.invalidateCredentials("discovery");

      expect(await provider.tokens()).toBeDefined();
      expect(await provider.discoveryState()).toBeUndefined();
    });
  });

  describe("key prefix isolation", () => {
    it("does not share data between providers with different server URLs", async () => {
      const otherProvider = new CredentialStoreOAuthProvider({
        store, // same store
        serverUrl: OTHER_SERVER_URL,
        clientMetadata: testMetadata,
      });

      await provider.saveTokens({
        access_token: "at-main",
        token_type: "Bearer",
      });

      // Other provider should not see the tokens
      expect(await otherProvider.tokens()).toBeUndefined();

      // Save tokens for other provider
      await otherProvider.saveTokens({
        access_token: "at-other",
        token_type: "Bearer",
      });

      // Each provider sees its own tokens
      const mainTokens = await provider.tokens();
      const otherTokens = await otherProvider.tokens();
      expect(mainTokens?.access_token).toBe("at-main");
      expect(otherTokens?.access_token).toBe("at-other");
    });
  });

  describe("properties", () => {
    it("exposes clientMetadata", () => {
      expect(provider.clientMetadata).toEqual(testMetadata);
    });

    it("returns undefined redirectUrl by default", () => {
      expect(provider.redirectUrl).toBeUndefined();
    });

    it("returns configured redirectUrl", () => {
      const p = new CredentialStoreOAuthProvider({
        store,
        serverUrl: TEST_SERVER_URL,
        clientMetadata: testMetadata,
        redirectUrl: "https://app.example.com/callback",
      });
      expect(p.redirectUrl).toBe("https://app.example.com/callback");
    });
  });
});
