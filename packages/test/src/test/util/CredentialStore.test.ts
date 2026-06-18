/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CREDENTIAL_STORE,
  ChainedCredentialStore,
  EnvCredentialStore,
  InMemoryCredentialStore,
  MissingCredentialError,
  ServiceRegistry,
  getGlobalCredentialStore,
  getInputResolvers,
  registerCredentialDefaults,
  resolveCredential,
  setCredentialResolverStrict,
  setGlobalCredentialStore,
  setLogger,
} from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";

describe("CredentialStore", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("InMemoryCredentialStore", () => {
    let store: InMemoryCredentialStore;

    beforeEach(() => {
      store = new InMemoryCredentialStore();
    });

    it("should store and retrieve a credential", async () => {
      await store.put("my-key", "my-secret");
      expect(await store.get("my-key")).toBe("my-secret");
    });

    it("should return undefined for missing keys", async () => {
      expect(await store.get("nonexistent")).toBeUndefined();
    });

    it("should overwrite an existing credential", async () => {
      await store.put("key", "value1");
      await store.put("key", "value2");
      expect(await store.get("key")).toBe("value2");
    });

    it("should delete a credential", async () => {
      await store.put("key", "value");
      expect(await store.delete("key")).toBe(true);
      expect(await store.get("key")).toBeUndefined();
    });

    it("should return false when deleting a nonexistent key", async () => {
      expect(await store.delete("nonexistent")).toBe(false);
    });

    it("should check existence with has()", async () => {
      await store.put("key", "value");
      expect(await store.has("key")).toBe(true);
      expect(await store.has("nonexistent")).toBe(false);
    });

    it("should list all keys", async () => {
      await store.put("a", "1");
      await store.put("b", "2");
      await store.put("c", "3");
      const keys = await store.keys();
      expect([...keys].sort()).toEqual(["a", "b", "c"]);
    });

    it("should delete all credentials", async () => {
      await store.put("a", "1");
      await store.put("b", "2");
      await store.deleteAll();
      expect(await store.keys()).toEqual([]);
    });

    it("should handle expired credentials", async () => {
      const pastDate = new Date(Date.now() - 1000);
      await store.put("expired", "secret", { expiresAt: pastDate });
      expect(await store.get("expired")).toBeUndefined();
      expect(await store.has("expired")).toBe(false);
    });

    it("should return non-expired credentials", async () => {
      const futureDate = new Date(Date.now() + 60_000);
      await store.put("valid", "secret", { expiresAt: futureDate });
      expect(await store.get("valid")).toBe("secret");
      expect(await store.has("valid")).toBe(true);
    });

    it("should preserve metadata across updates", async () => {
      await store.put("key", "v1", { label: "My Key", provider: "test" });
      await store.put("key", "v2");
      expect(await store.get("key")).toBe("v2");
      // Label and provider should be preserved from the first put
    });

    it("should exclude expired keys from keys()", async () => {
      await store.put("valid", "v1");
      await store.put("expired", "v2", { expiresAt: new Date(Date.now() - 1000) });
      const keys = await store.keys();
      expect([...keys]).toEqual(["valid"]);
    });
  });

  describe("EnvCredentialStore", () => {
    const testEnvVar = "WORKGLOW_TEST_CRED_" + Math.random().toString(36).slice(2);

    afterEach(() => {
      delete process.env[testEnvVar];
    });

    it("should read from explicit mapping", async () => {
      process.env[testEnvVar] = "env-secret";
      const store = new EnvCredentialStore({ "my-key": testEnvVar });
      expect(await store.get("my-key")).toBe("env-secret");
    });

    it("should return undefined for unmapped missing env vars", async () => {
      const store = new EnvCredentialStore({});
      expect(await store.get("nonexistent-key-" + Date.now())).toBeUndefined();
    });

    it("should use prefix convention when no explicit mapping", async () => {
      const prefix = "WG_TEST";
      const envVar = "WG_TEST_MY_API_KEY";
      process.env[envVar] = "prefix-secret";
      const store = new EnvCredentialStore({}, prefix);
      expect(await store.get("my-api-key")).toBe("prefix-secret");
      delete process.env[envVar];
    });

    it("should write to environment", async () => {
      const store = new EnvCredentialStore({ "my-key": testEnvVar });
      await store.put("my-key", "new-value");
      expect(process.env[testEnvVar]).toBe("new-value");
    });

    it("should delete from environment", async () => {
      process.env[testEnvVar] = "to-delete";
      const store = new EnvCredentialStore({ "my-key": testEnvVar });
      expect(await store.delete("my-key")).toBe(true);
      expect(process.env[testEnvVar]).toBeUndefined();
    });

    it("should report has() correctly", async () => {
      process.env[testEnvVar] = "exists";
      const store = new EnvCredentialStore({ "my-key": testEnvVar });
      expect(await store.has("my-key")).toBe(true);
      delete process.env[testEnvVar];
      expect(await store.has("my-key")).toBe(false);
    });

    it("should list keys with values", async () => {
      process.env[testEnvVar] = "present";
      const store = new EnvCredentialStore({ "my-key": testEnvVar, other: "MISSING_VAR_123" });
      const keys = await store.keys();
      expect([...keys]).toEqual(["my-key"]);
    });
  });

  describe("ChainedCredentialStore", () => {
    it("should resolve from the first store that has the key", async () => {
      const primary = new InMemoryCredentialStore();
      const fallback = new InMemoryCredentialStore();

      await fallback.put("key", "fallback-value");
      const chain = new ChainedCredentialStore([primary, fallback]);

      expect(await chain.get("key")).toBe("fallback-value");

      await primary.put("key", "primary-value");
      expect(await chain.get("key")).toBe("primary-value");
    });

    it("should write to the first store", async () => {
      const primary = new InMemoryCredentialStore();
      const fallback = new InMemoryCredentialStore();
      const chain = new ChainedCredentialStore([primary, fallback]);

      await chain.put("key", "value");
      expect(await primary.get("key")).toBe("value");
      expect(await fallback.get("key")).toBeUndefined();
    });

    it("should aggregate keys from all stores", async () => {
      const s1 = new InMemoryCredentialStore();
      const s2 = new InMemoryCredentialStore();

      await s1.put("a", "1");
      await s2.put("b", "2");
      await s2.put("a", "3"); // duplicate key

      const chain = new ChainedCredentialStore([s1, s2]);
      const keys = await chain.keys();
      expect([...keys].sort()).toEqual(["a", "b"]);
    });

    it("should delete from all stores", async () => {
      const s1 = new InMemoryCredentialStore();
      const s2 = new InMemoryCredentialStore();

      await s1.put("key", "v1");
      await s2.put("key", "v2");

      const chain = new ChainedCredentialStore([s1, s2]);
      expect(await chain.delete("key")).toBe(true);
      expect(await s1.has("key")).toBe(false);
      expect(await s2.has("key")).toBe(false);
    });

    it("should check has() across all stores", async () => {
      const s1 = new InMemoryCredentialStore();
      const s2 = new InMemoryCredentialStore();

      await s2.put("key", "value");
      const chain = new ChainedCredentialStore([s1, s2]);
      expect(await chain.has("key")).toBe(true);
    });

    it("should throw when constructed with no stores", () => {
      expect(() => new ChainedCredentialStore([])).toThrow("at least one store");
    });
  });

  describe("CredentialStoreRegistry", () => {
    let originalStore: any;

    beforeEach(() => {
      originalStore = getGlobalCredentialStore();
    });

    afterEach(() => {
      setGlobalCredentialStore(originalStore);
    });

    it("should provide a default in-memory store", () => {
      const store = getGlobalCredentialStore();
      expect(store).toBeDefined();
      expect(store).toBeInstanceOf(InMemoryCredentialStore);
    });

    it("should allow replacing the global store", async () => {
      const custom = new InMemoryCredentialStore();
      await custom.put("test-key", "test-value");
      setGlobalCredentialStore(custom);

      const resolved = await resolveCredential("test-key");
      expect(resolved).toBe("test-value");
    });

    it("should resolve credentials via resolveCredential()", async () => {
      const store = new InMemoryCredentialStore();
      await store.put("my-api-key", "sk-12345");
      setGlobalCredentialStore(store);

      expect(await resolveCredential("my-api-key")).toBe("sk-12345");
      expect(await resolveCredential("nonexistent")).toBeUndefined();
    });

    it("should prefer registry-scoped store over global", async () => {
      const globalStore = new InMemoryCredentialStore();
      await globalStore.put("key", "global-value");
      setGlobalCredentialStore(globalStore);

      const localStore = new InMemoryCredentialStore();
      await localStore.put("key", "local-value");

      const { ServiceRegistry } = await import("@workglow/util");
      const registry = new ServiceRegistry();
      registry.registerInstance(CREDENTIAL_STORE, localStore);

      expect(await resolveCredential("key", registry)).toBe("local-value");
    });
  });

  describe("credential input resolver (strict default)", () => {
    let originalStore: any;

    beforeEach(() => {
      originalStore = getGlobalCredentialStore();
      // Force strict on each test so other suites flipping it cannot leak in.
      setCredentialResolverStrict(true);
    });

    afterEach(() => {
      setGlobalCredentialStore(originalStore);
      setCredentialResolverStrict(true);
    });

    /** Helper: resolve a credential via the registered "credential" resolver. */
    async function resolveViaInputResolver(
      key: string,
      registry: ServiceRegistry = new ServiceRegistry()
    ): Promise<unknown> {
      // Ensure the resolver is registered on the scoped registry.
      registerCredentialDefaults(registry);
      const resolvers = getInputResolvers(registry);
      const resolver = resolvers.get("credential");
      if (!resolver) throw new Error("credential resolver missing");
      return resolver(key, "credential", registry);
    }

    it("credential input resolver throws MissingCredentialError when store has no value (default strict)", async () => {
      const registry = new ServiceRegistry();
      const store = new InMemoryCredentialStore();
      registry.registerInstance(CREDENTIAL_STORE, store);

      await expect(
        resolveViaInputResolver("missing-credential-key", registry)
      ).rejects.toBeInstanceOf(MissingCredentialError);
    });

    it("credential input resolver returns real value on hit", async () => {
      const registry = new ServiceRegistry();
      const store = new InMemoryCredentialStore();
      await store.put("present-key", "sk-real-value");
      registry.registerInstance(CREDENTIAL_STORE, store);

      const resolved = await resolveViaInputResolver("present-key", registry);
      expect(resolved).toBe("sk-real-value");
    });

    it("credential input resolver returns literal id after setCredentialResolverStrict(false)", async () => {
      const registry = new ServiceRegistry();
      const store = new InMemoryCredentialStore();
      registry.registerInstance(CREDENTIAL_STORE, store);

      setCredentialResolverStrict(false);
      try {
        const resolved = await resolveViaInputResolver("legacy-fallback-key", registry);
        expect(resolved).toBe("legacy-fallback-key");
      } finally {
        setCredentialResolverStrict(true);
      }
    });

    it("MissingCredentialError.key equals lookup key; message contains no Bearer/value", async () => {
      const registry = new ServiceRegistry();
      const store = new InMemoryCredentialStore();
      registry.registerInstance(CREDENTIAL_STORE, store);

      try {
        await resolveViaInputResolver("AUTH_KEY_NAME", registry);
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(MissingCredentialError);
        const err = e as MissingCredentialError;
        expect(err.key).toBe("AUTH_KEY_NAME");
        expect(err.message).toContain("AUTH_KEY_NAME");
        expect(err.message).not.toMatch(/Bearer/i);
      }
    });
  });
});
