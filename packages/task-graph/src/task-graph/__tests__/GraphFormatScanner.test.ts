/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { scanGraphForCredentials, scanGraphForFormat, Task, TaskGraph } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

// ---- Minimal task stubs for schema testing ----------------------------------------

class FlatCredentialTask extends Task<any, any> {
  static override readonly type = "FlatCredentialTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        api_key: { type: "string", format: "credential" },
        model: { type: "string" },
      },
    } as const satisfies DataPortSchema;
  }
}

class NestedCredentialTask extends Task<any, any> {
  static override readonly type = "NestedCredentialTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        provider_config: {
          type: "object",
          properties: {
            credential_key: { type: "string", format: "credential" },
            endpoint: { type: "string" },
          },
        },
      },
    } as const satisfies DataPortSchema;
  }
}

class OneOfCredentialTask extends Task<any, any> {
  static override readonly type = "OneOfCredentialTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        auth: {
          oneOf: [{ type: "string", format: "credential" }, { type: "null" }],
        },
      },
    } as const satisfies DataPortSchema;
  }
}

class AnyOfNestedCredentialTask extends Task<any, any> {
  static override readonly type = "AnyOfNestedCredentialTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        config: {
          anyOf: [
            {
              type: "object",
              properties: {
                secret: { type: "string", format: "credential" },
              },
            },
            { type: "null" },
          ],
        },
      },
    } as const satisfies DataPortSchema;
  }
}

/**
 * The shape of a task that forwards the key to an owned task rather than
 * consuming the secret itself: the input resolver must leave the port alone,
 * but the store still has to be unlocked before the run.
 */
class UnresolvedCredentialKeyTask extends Task<any, any> {
  static override readonly type = "UnresolvedCredentialKeyTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        credential_key: { type: "string", format: "credential-key" },
      },
    } as const satisfies DataPortSchema;
  }
}

/**
 * A port holding a MAP of credential keys — the format is annotated on the
 * `additionalProperties` value schema, since the key names are not known ahead
 * of time (they are provider names supplied by the caller).
 */
class MapCredentialKeyTask extends Task<any, any> {
  static override readonly type = "MapCredentialKeyTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        credential_keys: {
          type: "object",
          additionalProperties: { type: "string", format: "credential-key" },
        },
      },
    } as const satisfies DataPortSchema;
  }
}

class NoCredentialTask extends Task<any, any> {
  static override readonly type = "NoCredentialTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
        count: { type: "number" },
      },
    } as const satisfies DataPortSchema;
  }
}

class ConfigCredentialTask extends Task<any, any> {
  static override readonly type = "ConfigCredentialTask";

  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
    } as const satisfies DataPortSchema;
  }

  static override configSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        api_key: { type: "string", format: "credential" },
      },
    } as const satisfies DataPortSchema;
  }
}

// ---- Helpers -----------------------------------------------------------------------

function makeGraph(...tasks: Task<any, any>[]): TaskGraph {
  const graph = new TaskGraph();
  graph.addTasks(tasks);
  return graph;
}

// ---- Tests -------------------------------------------------------------------------

describe("GraphFormatScanner", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  describe("scanGraphForCredentials()", () => {
    it("returns needsCredentials=false for an empty graph", () => {
      const result = scanGraphForCredentials(makeGraph());
      expect(result.needsCredentials).toBe(false);
      expect(result.credentialFormats.size).toBe(0);
    });

    it("returns needsCredentials=false when no task has credential format", () => {
      const result = scanGraphForCredentials(makeGraph(new NoCredentialTask({})));
      expect(result.needsCredentials).toBe(false);
    });

    it("returns needsCredentials=false when the credential property is declared but unset", () => {
      // Schema carries `format: "credential"` but no value is set — typical of
      // local models where the provider_config.credential_key field exists in
      // the schema but isn't populated.
      const result = scanGraphForCredentials(makeGraph(new FlatCredentialTask({})));
      expect(result.needsCredentials).toBe(false);
    });

    it("detects a flat credential format when the value is set", () => {
      const result = scanGraphForCredentials(
        makeGraph(new FlatCredentialTask({ defaults: { api_key: "my-key" } as any }))
      );
      expect(result.needsCredentials).toBe(true);
      expect(result.credentialFormats.has("credential")).toBe(true);
    });

    it("detects a credential-key format, which the input resolver leaves alone", () => {
      const result = scanGraphForCredentials(
        makeGraph(
          new UnresolvedCredentialKeyTask({ defaults: { credential_key: "my-key" } as any })
        )
      );
      expect(result.needsCredentials).toBe(true);
      expect(result.credentialFormats.has("credential-key")).toBe(true);
    });

    it("detects a credential-key annotated on a map's value schema", () => {
      // The key names are provider names the caller chooses, so the format can
      // only be declared on `additionalProperties`. Missed there, the store is
      // never unlocked and every keyed request goes out unauthenticated.
      const result = scanGraphForCredentials(
        makeGraph(new MapCredentialKeyTask({ defaults: { credential_keys: { tavily: "k" } } }))
      );
      expect(result.needsCredentials).toBe(true);
      expect(result.credentialFormats.has("credential-key")).toBe(true);
    });

    it("ignores an empty credential-key map", () => {
      const result = scanGraphForCredentials(
        makeGraph(new MapCredentialKeyTask({ defaults: { credential_keys: {} } }))
      );
      expect(result.needsCredentials).toBe(false);
    });

    it("ignores a credential-key map whose only entry is an empty string", () => {
      const result = scanGraphForCredentials(
        makeGraph(new MapCredentialKeyTask({ defaults: { credential_keys: { tavily: "" } } }))
      );
      expect(result.needsCredentials).toBe(false);
    });

    it("ignores a declared-but-unset credential-key", () => {
      const result = scanGraphForCredentials(makeGraph(new UnresolvedCredentialKeyTask({})));
      expect(result.needsCredentials).toBe(false);
    });

    it("does not detect an empty-string credential value", () => {
      const result = scanGraphForCredentials(
        makeGraph(new FlatCredentialTask({ defaults: { api_key: "" } as any }))
      );
      expect(result.needsCredentials).toBe(false);
    });

    it("detects a credential format in a nested object property when the value is set", () => {
      const result = scanGraphForCredentials(
        makeGraph(
          new NestedCredentialTask({
            defaults: { provider_config: { credential_key: "my-key" } } as any,
          })
        )
      );
      expect(result.needsCredentials).toBe(true);
    });

    it("ignores a declared-but-unset nested credential (the local-model case)", () => {
      const result = scanGraphForCredentials(
        makeGraph(
          new NestedCredentialTask({
            defaults: { provider_config: { endpoint: "https://example.invalid" } } as any,
          })
        )
      );
      expect(result.needsCredentials).toBe(false);
    });

    it("detects a credential format inside a oneOf wrapper when the value is set", () => {
      const result = scanGraphForCredentials(
        makeGraph(new OneOfCredentialTask({ defaults: { auth: "token" } as any }))
      );
      expect(result.needsCredentials).toBe(true);
    });

    it("detects a credential format inside an anyOf nested object when the value is set", () => {
      const result = scanGraphForCredentials(
        makeGraph(
          new AnyOfNestedCredentialTask({
            defaults: { config: { secret: "shhh" } } as any,
          })
        )
      );
      expect(result.needsCredentials).toBe(true);
    });

    it("detects a credential format in config schema when the value is set", () => {
      const result = scanGraphForCredentials(
        makeGraph(new ConfigCredentialTask({ api_key: "my-key" } as any))
      );
      expect(result.needsCredentials).toBe(true);
    });

    it("ignores a declared-but-unset credential in config schema", () => {
      const result = scanGraphForCredentials(makeGraph(new ConfigCredentialTask({})));
      expect(result.needsCredentials).toBe(false);
    });

    it("returns false when non-credential task is mixed with no-credential task", () => {
      const result = scanGraphForCredentials(makeGraph(new NoCredentialTask({})));
      expect(result.needsCredentials).toBe(false);
    });

    it("returns true when at least one task in a multi-task graph has a set credential", () => {
      const result = scanGraphForCredentials(
        makeGraph(
          new NoCredentialTask({}),
          new FlatCredentialTask({ defaults: { api_key: "my-key" } as any })
        )
      );
      expect(result.needsCredentials).toBe(true);
    });
  });

  describe("scanGraphForFormat()", () => {
    it("returns false for an empty graph", () => {
      expect(scanGraphForFormat(makeGraph(), "credential")).toBe(false);
    });

    it("returns false when target format is absent", () => {
      expect(scanGraphForFormat(makeGraph(new NoCredentialTask({})), "credential")).toBe(false);
    });

    it("returns true when flat credential format is present", () => {
      expect(scanGraphForFormat(makeGraph(new FlatCredentialTask({})), "credential")).toBe(true);
    });

    it("returns false for a different format string", () => {
      expect(scanGraphForFormat(makeGraph(new FlatCredentialTask({})), "model")).toBe(false);
    });

    it("returns true for nested credential format", () => {
      expect(scanGraphForFormat(makeGraph(new NestedCredentialTask({})), "credential")).toBe(true);
    });

    it("returns true for oneOf credential format", () => {
      expect(scanGraphForFormat(makeGraph(new OneOfCredentialTask({})), "credential")).toBe(true);
    });

    it("returns true for a format annotated on a map's value schema", () => {
      expect(scanGraphForFormat(makeGraph(new MapCredentialKeyTask({})), "credential-key")).toBe(
        true
      );
    });
  });
});
