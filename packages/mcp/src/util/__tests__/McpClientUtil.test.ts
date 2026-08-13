/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveMcpClientAuth } from "@workglow/mcp/util";
import {
  globalServiceRegistry,
  InMemoryCredentialStore,
  MissingCredentialError,
  ServiceRegistry,
  setGlobalCredentialStore,
} from "@workglow/util";
import { describe, expect, it } from "vitest";

function scopedRegistry(): ServiceRegistry {
  return new ServiceRegistry(globalServiceRegistry.container.createChildContainer());
}

describe("resolveMcpClientAuth credential scoping", () => {
  it("resolves bearer credential keys through the provided run registry", async () => {
    const registry = scopedRegistry();
    const store = new InMemoryCredentialStore();
    await store.put("mcp-token-key", "sekret-value");
    setGlobalCredentialStore(store, registry);

    const { auth, headers } = await resolveMcpClientAuth(
      {
        transport: "streamable-http",
        server_url: "https://mcp.example.com",
        auth: { type: "bearer", token: "mcp-token-key" },
      },
      registry
    );

    expect(auth).toEqual({ type: "bearer", token: "sekret-value" });
    expect(headers.Authorization).toBe("Bearer sekret-value");
  });

  it("fails closed (no literal-token bearer leak) when the scoped store has no such key", async () => {
    const registry = scopedRegistry();
    setGlobalCredentialStore(new InMemoryCredentialStore(), registry);

    await expect(
      resolveMcpClientAuth(
        {
          transport: "streamable-http",
          server_url: "https://mcp.example.com",
          auth: { type: "bearer", token: "literal-token" },
        },
        registry
      )
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it("does not leak credentials across scoped registries", async () => {
    const registryA = scopedRegistry();
    const storeA = new InMemoryCredentialStore();
    await storeA.put("shared-key", "alpha");
    setGlobalCredentialStore(storeA, registryA);

    const registryB = scopedRegistry();
    const storeB = new InMemoryCredentialStore();
    await storeB.put("shared-key", "bravo");
    setGlobalCredentialStore(storeB, registryB);

    const config = {
      transport: "streamable-http",
      server_url: "https://mcp.example.com",
      auth: { type: "bearer", token: "shared-key" } as const,
    };
    const a = await resolveMcpClientAuth(config, registryA);
    const b = await resolveMcpClientAuth(config, registryB);

    expect(a.headers.Authorization).toBe("Bearer alpha");
    expect(b.headers.Authorization).toBe("Bearer bravo");
  });
});
