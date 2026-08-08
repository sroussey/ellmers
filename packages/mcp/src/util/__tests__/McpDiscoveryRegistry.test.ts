/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpPromptGetTask, McpToolCallTask } from "@workglow/mcp/tasks";
import { mcpClientFactory, resolveMcpClientAuth } from "@workglow/mcp/util";
import {
  globalServiceRegistry,
  InMemoryCredentialStore,
  ServiceRegistry,
  setGlobalCredentialStore,
} from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function scopedRegistry(): ServiceRegistry {
  return new ServiceRegistry(globalServiceRegistry.container.createChildContainer());
}

type FactoryCall = {
  readonly registry: ServiceRegistry | undefined;
  readonly bearer: string | undefined;
};

function recordingFactory(): {
  readonly calls: FactoryCall[];
  readonly install: () => void;
  readonly restore: () => void;
} {
  const calls: FactoryCall[] = [];
  const original = mcpClientFactory.create;

  const mockListTools = async () => ({
    tools: [{ name: "greet", inputSchema: { type: "object", properties: {} } }],
  });
  const mockListPrompts = async () => ({
    prompts: [{ name: "hello", arguments: [] }],
  });
  const mockCallTool = async () => ({
    content: [{ type: "text", text: "ok" }],
    isError: false,
  });
  const mockGetPrompt = async () => ({
    messages: [{ role: "user" as const, content: { type: "text" as const, text: "hi" } }],
    description: "test prompt",
  });

  const fakeClient = {
    listTools: mockListTools,
    listPrompts: mockListPrompts,
    callTool: mockCallTool,
    getPrompt: mockGetPrompt,
    close: async () => undefined,
  };

  const install = (): void => {
    mcpClientFactory.create = (async (
      config: { auth?: { type?: string; token?: string } },
      _signal?: AbortSignal,
      registry?: ServiceRegistry
    ) => {
      const { headers } = await resolveMcpClientAuth(
        config as Parameters<typeof resolveMcpClientAuth>[0],
        registry
      );
      const bearer = headers.Authorization?.startsWith("Bearer ")
        ? headers.Authorization.slice("Bearer ".length)
        : undefined;
      calls.push({ registry, bearer });
      return { client: fakeClient as never, transport: {} as never };
    }) as typeof mcpClientFactory.create;
  };

  const restore = (): void => {
    mcpClientFactory.create = original;
  };

  return { calls, install, restore };
}

const httpServer = {
  transport: "streamable-http" as const,
  server_url: "https://mcp.example.com",
  auth_type: "bearer" as const,
  auth_token: "scoped-key",
};

describe("MCP discoverSchemas registry threading", () => {
  let recorder: ReturnType<typeof recordingFactory>;

  beforeEach(() => {
    recorder = recordingFactory();
    recorder.install();
  });

  afterEach(() => {
    recorder.restore();
  });

  it("McpToolCallTask: discovery hop resolves bearer through the run-scoped registry", async () => {
    const globalReg = scopedRegistry();
    const globalStore = new InMemoryCredentialStore();
    await globalStore.put("scoped-key", "WRONG-global-value");
    setGlobalCredentialStore(globalStore, globalReg);

    const runReg = scopedRegistry();
    const runStore = new InMemoryCredentialStore();
    await runStore.put("scoped-key", "RIGHT-run-value");
    setGlobalCredentialStore(runStore, runReg);

    const task = new McpToolCallTask({ server: httpServer, tool_name: "greet" });
    await task.run({}, { registry: runReg });

    expect(recorder.calls.length).toBeGreaterThanOrEqual(2);
    // The discovery (list-tools) hop is the first client.create — that's the one
    // the bug-fix targets. It must resolve the bearer against the run registry.
    const discoveryCall = recorder.calls[0];
    expect(discoveryCall.bearer).toBe("RIGHT-run-value");
    expect(discoveryCall.bearer).not.toBe("scoped-key");

    // Sanity check: the subsequent tool-call hop also resolves through the run registry.
    const toolCall = recorder.calls[recorder.calls.length - 1];
    expect(toolCall.bearer).toBe("RIGHT-run-value");
  });

  it("McpPromptGetTask: discovery hop resolves bearer through the run-scoped registry", async () => {
    const globalReg = scopedRegistry();
    const globalStore = new InMemoryCredentialStore();
    await globalStore.put("scoped-key", "WRONG-global-value");
    setGlobalCredentialStore(globalStore, globalReg);

    const runReg = scopedRegistry();
    const runStore = new InMemoryCredentialStore();
    await runStore.put("scoped-key", "RIGHT-run-value");
    setGlobalCredentialStore(runStore, runReg);

    const task = new McpPromptGetTask({ server: httpServer, prompt_name: "hello" });
    await task.run({}, { registry: runReg });

    expect(recorder.calls.length).toBeGreaterThanOrEqual(2);
    const discoveryCall = recorder.calls[0];
    expect(discoveryCall.bearer).toBe("RIGHT-run-value");
    expect(discoveryCall.bearer).not.toBe("scoped-key");
  });

  it("discovery does not leak the literal credential key as a bearer (client_credentials path)", async () => {
    // The same fallback (`resolved ?? value`) applies to client_credentials' client_secret.
    // When the discovery hop misses the scoped store and falls back, it must not send the
    // literal key. This guards the secret slot — auth.type "client_credentials" carries an
    // OAuth-provider path that never produces a bearer header, so we assert via the resolver.
    const runReg = scopedRegistry();
    const runStore = new InMemoryCredentialStore();
    await runStore.put("ccred-secret-key", "real-client-secret");
    setGlobalCredentialStore(runStore, runReg);

    const { auth } = await resolveMcpClientAuth(
      {
        transport: "streamable-http",
        server_url: "https://mcp.example.com",
        auth: {
          type: "client_credentials",
          client_id: "id",
          client_secret: "ccred-secret-key",
        },
      },
      runReg
    );

    expect(auth?.type).toBe("client_credentials");
    if (auth?.type === "client_credentials") {
      expect(auth.client_secret).toBe("real-client-secret");
      expect(auth.client_secret).not.toBe("ccred-secret-key");
    }
  });
});
