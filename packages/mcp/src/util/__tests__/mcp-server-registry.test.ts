/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpListTask, McpToolCallTask } from "@workglow/mcp/tasks";
import type { McpServerRecord, McpServerRepository } from "@workglow/mcp/util";
import {
  getGlobalMcpServerRepository,
  getGlobalMcpServers,
  getMcpServer,
  getMcpServerConfig,
  InMemoryMcpServerRepository,
  MCP_SERVERS,
  mcpClientFactory,
  registerMcpServer,
  setGlobalMcpServerRepository,
} from "@workglow/mcp/util";
import type { IExecuteContext, TaskConfig } from "@workglow/task-graph";
import { resolveSchemaInputs, Task } from "@workglow/task-graph";
import { Container, globalServiceRegistry, ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const serverA: McpServerRecord = {
  server_id: "server-a",
  label: "Server A",
  description: "Test server A",
  transport: "streamable-http",
  server_url: "http://localhost:3000/mcp",
};

const serverB: McpServerRecord = {
  server_id: "server-b",
  label: "Server B",
  description: "Test server B",
  transport: "stdio",
  command: "node",
  args: ["server.js"],
};

describe("McpServerRepository", () => {
  let repo: McpServerRepository;

  beforeEach(() => {
    repo = new InMemoryMcpServerRepository();
  });

  test("addServer stores and returns the record", async () => {
    const result = await repo.addServer(serverA);
    expect(result).toEqual(serverA);
  });

  test("getServer retrieves a stored record", async () => {
    await repo.addServer(serverA);
    const result = await repo.getServer("server-a");
    expect(result).toEqual(serverA);
  });

  test("getServer returns undefined for unknown ID", async () => {
    const result = await repo.getServer("nonexistent");
    expect(result).toBeUndefined();
  });

  test("removeServer deletes a stored record", async () => {
    await repo.addServer(serverA);
    await repo.removeServer("server-a");
    const result = await repo.getServer("server-a");
    expect(result).toBeUndefined();
  });

  test("removeServer throws for unknown ID", async () => {
    await expect(repo.removeServer("nonexistent")).rejects.toThrow(
      'MCP server with id "nonexistent" not found'
    );
  });

  test("enumerateAll returns all stored records", async () => {
    await repo.addServer(serverA);
    await repo.addServer(serverB);
    const all = await repo.enumerateAll();
    expect(all).toHaveLength(2);
    expect(all).toEqual(expect.arrayContaining([serverA, serverB]));
  });

  test("enumerateAll returns empty array when empty", async () => {
    const all = await repo.enumerateAll();
    expect(all).toEqual([]);
  });

  test("size returns count of stored records", async () => {
    expect(await repo.size()).toBe(0);
    await repo.addServer(serverA);
    expect(await repo.size()).toBe(1);
    await repo.addServer(serverB);
    expect(await repo.size()).toBe(2);
  });

  test("addServer overwrites duplicate ID", async () => {
    await repo.addServer(serverA);
    const updated: McpServerRecord = { ...serverA, label: "Updated A" };
    await repo.addServer(updated);
    const result = await repo.getServer("server-a");
    expect(result?.label).toBe("Updated A");
    expect(await repo.size()).toBe(1);
  });

  test("emits server_added event", async () => {
    const events: McpServerRecord[] = [];
    repo.on("server_added", (record) => events.push(record));
    await repo.addServer(serverA);
    expect(events).toEqual([serverA]);
  });

  test("emits server_updated event on overwrite", async () => {
    const added: McpServerRecord[] = [];
    const updated: McpServerRecord[] = [];
    repo.on("server_added", (record) => added.push(record));
    repo.on("server_updated", (record) => updated.push(record));
    await repo.addServer(serverA);
    const updatedRecord: McpServerRecord = { ...serverA, label: "Updated A" };
    await repo.addServer(updatedRecord);
    expect(added).toEqual([serverA]);
    expect(updated).toEqual([updatedRecord]);
  });

  test("emits server_removed event", async () => {
    const events: McpServerRecord[] = [];
    repo.on("server_removed", (record) => events.push(record));
    await repo.addServer(serverA);
    await repo.removeServer("server-a");
    expect(events).toEqual([serverA]);
  });
});

describe("McpServerRegistry", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
    setGlobalMcpServerRepository(new InMemoryMcpServerRepository());
  });

  test("registerMcpServer adds to live map and repository", async () => {
    await registerMcpServer(serverA);
    expect(getMcpServer("server-a")?.config).toEqual(serverA);

    const repo = getGlobalMcpServerRepository();
    const record = await repo.getServer("server-a");
    expect(record).toEqual(serverA);
  });

  test("getMcpServer returns undefined for unknown ID", () => {
    expect(getMcpServer("nonexistent")).toBeUndefined();
  });

  test("scoped registries are independent", async () => {
    await registerMcpServer(serverA);

    const child = new ServiceRegistry(new Container());
    const scopedMap = new Map();
    child.registerInstance(MCP_SERVERS, scopedMap);

    const scopedServers = child.get(MCP_SERVERS);
    expect(scopedServers.get("server-a")).toBeUndefined();

    expect(getMcpServer("server-a")?.config).toEqual(serverA);
  });
});

describe("mcp-server input resolver", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
    setGlobalMcpServerRepository(new InMemoryMcpServerRepository());
  });

  test("resolves string server ID to config record", async () => {
    await registerMcpServer(serverA);

    const schema = {
      type: "object" as const,
      properties: {
        server: { type: "string" as const, format: "mcp-server" },
      },
    };
    const input = { server: "server-a" };
    const resolved = await resolveSchemaInputs(input, schema, {
      registry: globalServiceRegistry,
    });

    expect(resolved.server).toEqual(serverA);
  });

  test("throws for unknown server ID", async () => {
    const schema = {
      type: "object" as const,
      properties: {
        server: { type: "string" as const, format: "mcp-server" },
      },
    };
    const input = { server: "nonexistent" };
    await expect(
      resolveSchemaInputs(input, schema, { registry: globalServiceRegistry })
    ).rejects.toThrow('MCP server "nonexistent" not found');
  });

  test("non-string values pass through unchanged", async () => {
    const schema = {
      type: "object" as const,
      properties: {
        server: {
          oneOf: [
            { type: "string" as const, format: "mcp-server" },
            { type: "object" as const, format: "mcp-server" },
          ],
        },
      },
    };
    const inlineConfig = { transport: "sse", server_url: "http://example.com" };
    const input = { server: inlineConfig };
    const resolved = await resolveSchemaInputs(input, schema, {
      registry: globalServiceRegistry,
    });

    expect(resolved.server).toEqual(inlineConfig);
  });

  test("scoped registry takes precedence over global", async () => {
    await registerMcpServer(serverA);

    const child = new ServiceRegistry(new Container());
    const scopedMap = new Map();
    scopedMap.set("server-a", { config: serverB });
    child.registerInstance(MCP_SERVERS, scopedMap);

    const schema = {
      type: "object" as const,
      properties: {
        server: { type: "string" as const, format: "mcp-server" },
      },
    };
    const input = { server: "server-a" };
    const resolved = await resolveSchemaInputs(input, schema, {
      registry: child,
    });

    expect(resolved.server).toEqual(serverB);
  });
});

describe("getMcpServerConfig", () => {
  test("returns server config from resolved server object on config", () => {
    const config = {
      server: {
        server_id: "a",
        transport: "streamable-http",
        server_url: "http://localhost:3000/mcp",
      },
    };
    const result = getMcpServerConfig(config);
    expect(result.transport).toBe("streamable-http");
    expect(result.server_url).toBe("http://localhost:3000/mcp");
  });

  test("works when server is an inline object", () => {
    const config = {
      server: {
        transport: "sse",
        server_url: "http://inline.com",
      },
    };
    const result = getMcpServerConfig(config);
    expect(result.transport).toBe("sse");
    expect(result.server_url).toBe("http://inline.com");
  });

  test("throws when server is missing", () => {
    expect(() => getMcpServerConfig({})).toThrow(
      "MCP server config must include a 'server' property"
    );
  });

  test("throws when server is a string (unresolved)", () => {
    expect(() => getMcpServerConfig({ server: "server-a" })).toThrow(
      "should have been resolved to an object"
    );
  });

  test("throws when server object has no transport", () => {
    expect(() => getMcpServerConfig({ server: { server_url: "http://example.com" } })).toThrow(
      "MCP server config must include a transport"
    );
  });

  test("throws when stdio transport is missing command", () => {
    expect(() => getMcpServerConfig({ server: { transport: "stdio" } })).toThrow(
      "MCP server config for stdio transport must include a 'command'"
    );
  });

  test("throws when sse transport is missing server_url", () => {
    expect(() => getMcpServerConfig({ server: { transport: "sse" } })).toThrow(
      "MCP server config for sse/streamable-http transport must include a 'server_url'"
    );
  });

  test("throws when streamable-http transport is missing server_url", () => {
    expect(() => getMcpServerConfig({ server: { transport: "streamable-http" } })).toThrow(
      "MCP server config for sse/streamable-http transport must include a 'server_url'"
    );
  });

  test("includes auth fields from server object", () => {
    const config = {
      server: {
        server_id: "a",
        transport: "streamable-http",
        server_url: "http://localhost:3000",
        auth_type: "bearer",
        auth_token: "secret-token",
      },
    };
    const result = getMcpServerConfig(config);
    expect((result as Record<string, unknown>).auth_type).toBe("bearer");
  });
});

class ConfigResolverTestTask extends Task<
  { value: string },
  { result: string; configServer: unknown },
  TaskConfig & { server?: unknown }
> {
  static override readonly type = "ConfigResolverTestTask";
  static override readonly category = "Test";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    } as const satisfies DataPortSchema;
  }

  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        result: { type: "string" },
        configServer: { type: "object", additionalProperties: true },
      },
      required: ["result"],
    } as const satisfies DataPortSchema;
  }

  static override configSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        server: { type: "string", format: "mcp-server" },
      },
    } as const satisfies DataPortSchema;
  }

  override async execute(
    input: { value: string },
    _context: IExecuteContext
  ): Promise<{ result: string; configServer: unknown }> {
    return {
      result: input.value,
      configServer: (this.config as Record<string, unknown>).server,
    };
  }
}

describe("TaskRunner config resolution", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
    setGlobalMcpServerRepository(new InMemoryMcpServerRepository());
  });

  test("config.server is resolved to full record on task.config", async () => {
    await registerMcpServer(serverA);
    const task = new ConfigResolverTestTask({ server: "server-a" });
    const output = await task.run({ value: "hello" });

    // execute() reads from this.config.server — it should be the resolved object
    expect(output.configServer).toEqual(serverA);
  });

  test("original config is preserved for toJSON", async () => {
    await registerMcpServer(serverA);
    const task = new ConfigResolverTestTask({ server: "server-a" });
    await task.run({ value: "hello" });

    // task.config.server was mutated to the resolved object
    expect((task.config as Record<string, unknown>).server).toEqual(serverA);

    // But toJSON should use the original snapshot with the string ID
    const json = task.toJSON();
    expect((json.config as Record<string, unknown> | undefined)?.server).toBe("server-a");
  });

  test("config resolution is a no-op when config has no format annotations", async () => {
    const task = new ConfigResolverTestTask();
    const output = await task.run({ value: "hello" });
    expect(output.configServer).toBeUndefined();
  });
});

// Mock helpers (same pattern as existing mcp.test.ts)
function fn() {
  const calls: unknown[][] = [];
  const mock = (...args: unknown[]) => {
    calls.push(args);
    return mock._result;
  };
  mock.calls = calls;
  mock._result = undefined as unknown;
  mock.mockResolvedValue = (val: unknown) => {
    mock._result = Promise.resolve(val);
    return mock;
  };
  return mock;
}

function createMockClient(overrides: Record<string, unknown> = {}) {
  return {
    callTool: fn(),
    readResource: fn(),
    getPrompt: fn(),
    listTools: fn().mockResolvedValue({ tools: [] }),
    listResources: fn().mockResolvedValue({ resources: [] }),
    listPrompts: fn().mockResolvedValue({ prompts: [] }),
    close: fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const originalCreate = mcpClientFactory.create;

function mockFactory(mockClient: ReturnType<typeof createMockClient>) {
  mcpClientFactory.create = (() =>
    Promise.resolve({
      client: mockClient,
      transport: {},
    })) as unknown as typeof mcpClientFactory.create;
}

describe("MCP tasks with server registry", () => {
  beforeEach(() => {
    getGlobalMcpServers().clear();
    setGlobalMcpServerRepository(new InMemoryMcpServerRepository());
    mcpClientFactory.create = originalCreate;
  });

  afterEach(() => {
    mcpClientFactory.create = originalCreate;
  });

  test("McpToolCallTask with server ID in config", async () => {
    await registerMcpServer(serverA);
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "hello" }],
        isError: false,
      }),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask({ server: "server-a", tool_name: "greet" });
    const result = await task.run({ name: "world" });

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.isError).toBe(false);
  });

  test("McpToolCallTask with inline server object in config", async () => {
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "hi" }],
        isError: false,
      }),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask({
      server: { transport: "streamable-http", server_url: "http://inline.com" },
      tool_name: "greet",
    });
    const result = await task.run({});

    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
  });

  test("McpToolCallTask with inline server object", async () => {
    const mockClient = createMockClient({
      callTool: fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        isError: false,
      }),
    });
    mockFactory(mockClient);

    const task = new McpToolCallTask({
      server: { transport: "stdio", command: "test-server" },
      tool_name: "greet",
    });
    const result = await task.run({});

    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
  });

  test("McpListTask with server ID in input", async () => {
    await registerMcpServer(serverA);
    const tools = [{ name: "greet", inputSchema: {} }];
    const mockClient = createMockClient({
      listTools: fn().mockResolvedValue({ tools }),
    });
    mockFactory(mockClient);

    const task = new McpListTask();
    const result = await task.run({
      server: "server-a",
      list_type: "tools",
    });

    expect((result as { tools: unknown }).tools).toEqual(tools);
  });
});
