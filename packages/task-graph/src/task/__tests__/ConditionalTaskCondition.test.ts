/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UIConditionConfig } from "@workglow/task-graph";
import { ConditionalTask } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

// ============================================================================
// ConditionalTask with serialized conditionConfig
// ============================================================================

describe("ConditionalTask with serialized conditionConfig", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("conditionConfig from input", () => {
    it("should route to matching branch based on field/operator/value", async () => {
      const task = new ConditionalTask({
        branches: [], // empty branches - will be built from conditionConfig
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "high", field: "value", operator: "greater_than", value: "100" },
          { id: "low", field: "value", operator: "less_or_equal", value: "100" },
        ],
        exclusive: true,
      };

      await task.run({ value: 150, conditionConfig });

      expect(task.isBranchActive("high")).toBe(true);
      expect(task.isBranchActive("low")).toBe(false);
    });

    it("treats a non-numeric field as a non-match for ordering operators (no silent NaN)", async () => {
      const task = new ConditionalTask({ branches: [] });

      const conditionConfig: UIConditionConfig = {
        branches: [{ id: "high", field: "value", operator: "greater_than", value: "100" }],
        exclusive: true,
      };

      // `value` is a non-numeric string; greater_than must evaluate to false
      // (and not silently treat NaN as a never-firing comparison).
      await task.run({ value: "not-a-number", conditionConfig });

      expect(task.isBranchActive("high")).toBe(false);
    });

    it("should route to second branch when first does not match", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "high", field: "value", operator: "greater_than", value: "100" },
          { id: "low", field: "value", operator: "less_or_equal", value: "100" },
        ],
        exclusive: true,
      };

      await task.run({ value: 50, conditionConfig });

      expect(task.isBranchActive("high")).toBe(false);
      expect(task.isBranchActive("low")).toBe(true);
    });

    it("should output data with numbered suffix for matched branch", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "yes", field: "status", operator: "equals", value: "active" },
          { id: "no", field: "status", operator: "not_equals", value: "active" },
        ],
        exclusive: true,
      };

      const result = await task.run({ status: "active", data: "hello", conditionConfig });

      // Branch 1 matched, so outputs should have _1 suffix
      expect(result).toHaveProperty("status_1", "active");
      expect(result).toHaveProperty("data_1", "hello");
      // Should NOT have _2 or _else
      expect(result).not.toHaveProperty("status_2");
      expect(result).not.toHaveProperty("status_else");
    });

    it("should output data with _else suffix when no branch matches", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [{ id: "high", field: "value", operator: "greater_than", value: "1000" }],
        exclusive: true,
      };

      const result = await task.run({ value: 5, conditionConfig });

      expect(result).toHaveProperty("value_else", 5);
      expect(result).not.toHaveProperty("value_1");
    });
  });

  describe("exclusive vs non-exclusive mode", () => {
    it("should only activate first matching branch in exclusive mode", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "a", field: "value", operator: "greater_than", value: "0" },
          { id: "b", field: "value", operator: "greater_than", value: "5" },
        ],
        exclusive: true,
      };

      await task.run({ value: 10, conditionConfig });

      expect(task.isBranchActive("a")).toBe(true);
      expect(task.isBranchActive("b")).toBe(false);
    });

    it("should activate all matching branches in non-exclusive mode", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "a", field: "value", operator: "greater_than", value: "0" },
          { id: "b", field: "value", operator: "greater_than", value: "5" },
        ],
        exclusive: false,
      };

      await task.run({ value: 10, conditionConfig });

      expect(task.isBranchActive("a")).toBe(true);
      expect(task.isBranchActive("b")).toBe(true);
    });

    it("should output to multiple branches in non-exclusive mode", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "a", field: "value", operator: "greater_than", value: "0" },
          { id: "b", field: "value", operator: "greater_than", value: "5" },
        ],
        exclusive: false,
      };

      const result = await task.run({ value: 10, conditionConfig });

      // Both branches match, so both _1 and _2 outputs should exist
      expect(result).toHaveProperty("value_1", 10);
      expect(result).toHaveProperty("value_2", 10);
    });
  });

  describe("default branch", () => {
    it("should activate default branch when no conditions match", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "high", field: "value", operator: "greater_than", value: "100" },
          { id: "fallback", field: "value", operator: "greater_than", value: "200" },
        ],
        exclusive: true,
        defaultBranch: "fallback",
      };

      await task.run({ value: 5, conditionConfig });

      expect(task.isBranchActive("high")).toBe(false);
      expect(task.isBranchActive("fallback")).toBe(true);
    });
  });

  describe("nested field paths", () => {
    it("should access nested fields via dot notation", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "admin", field: "user.role", operator: "equals", value: "admin" },
          { id: "user", field: "user.role", operator: "not_equals", value: "admin" },
        ],
        exclusive: true,
      };

      await task.run({
        user: { role: "admin", name: "Alice" },
        conditionConfig,
      });

      expect(task.isBranchActive("admin")).toBe(true);
      expect(task.isBranchActive("user")).toBe(false);
    });

    it("should handle deep nested field paths", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [{ id: "match", field: "data.nested.value", operator: "equals", value: "42" }],
        exclusive: true,
      };

      await task.run({
        data: { nested: { value: 42 } },
        conditionConfig,
      });

      expect(task.isBranchActive("match")).toBe(true);
    });

    it("should not match when nested path does not exist", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "match", field: "data.nonexistent.value", operator: "equals", value: "42" },
        ],
        exclusive: true,
      };

      await task.run({
        data: { other: 1 },
        conditionConfig,
      });

      expect(task.isBranchActive("match")).toBe(false);
    });
  });

  describe("various operators via conditionConfig", () => {
    it("should work with contains operator", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [{ id: "match", field: "name", operator: "contains", value: "world" }],
        exclusive: true,
      };

      await task.run({ name: "hello world", conditionConfig });
      expect(task.isBranchActive("match")).toBe(true);
    });

    it("should work with starts_with operator", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [{ id: "match", field: "name", operator: "starts_with", value: "hello" }],
        exclusive: true,
      };

      await task.run({ name: "hello world", conditionConfig });
      expect(task.isBranchActive("match")).toBe(true);
    });

    it("should work with is_empty operator", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [
          { id: "empty", field: "name", operator: "is_empty", value: "" },
          { id: "not_empty", field: "name", operator: "is_not_empty", value: "" },
        ],
        exclusive: true,
      };

      await task.run({ name: "", conditionConfig });
      expect(task.isBranchActive("empty")).toBe(true);
      expect(task.isBranchActive("not_empty")).toBe(false);
    });

    it("should work with is_true / is_false operators", async () => {
      const task = new ConditionalTask({
        branches: [],
      });

      const conditionConfig: UIConditionConfig = {
        branches: [{ id: "truthy", field: "active", operator: "is_true", value: "" }],
        exclusive: true,
      };

      await task.run({ active: true, conditionConfig });
      expect(task.isBranchActive("truthy")).toBe(true);
    });
  });

  describe("conditionConfig from config", () => {
    it("should use conditionConfig from config when input has none", async () => {
      const task = new ConditionalTask({
        conditionConfig: {
          branches: [
            { id: "high", field: "value", operator: "greater_than", value: "50" },
            { id: "low", field: "value", operator: "less_or_equal", value: "50" },
          ],
          exclusive: true,
        },
      });

      await task.run({ value: 100 });

      expect(task.isBranchActive("high")).toBe(true);
      expect(task.isBranchActive("low")).toBe(false);
    });
  });

  describe("function conditions still work", () => {
    it("should prefer config.branches with functions over conditionConfig", async () => {
      const task = new ConditionalTask({
        branches: [{ id: "fn-branch", condition: (i: any) => i.value > 10, outputPort: "high" }],
      });

      // Even if conditionConfig is provided, function branches should be used
      const conditionConfig: UIConditionConfig = {
        branches: [{ id: "cfg-branch", field: "value", operator: "less_than", value: "5" }],
        exclusive: true,
      };

      await task.run({ value: 20, conditionConfig });

      // Function branch should win
      expect(task.isBranchActive("fn-branch")).toBe(true);
    });
  });

  describe("derived output schema", () => {
    const triageInputSchema = {
      type: "object",
      properties: {
        categories: { type: "array", items: { type: "string" } },
        message: { type: "string" },
      },
      additionalProperties: true,
    } as const satisfies DataPortSchema;

    const triageConditionConfig: UIConditionConfig = {
      branches: [{ id: "confident", field: "score", operator: "greater_or_equal", value: "0.8" }],
      exclusive: true,
    };

    it("derives suffixed ports from conditionConfig and the declared input ports", () => {
      const task = new ConditionalTask({
        inputSchema: triageInputSchema,
        conditionConfig: triageConditionConfig,
      });

      const schema = task.outputSchema();
      expect(typeof schema).toBe("object");
      const properties = (schema as Exclude<DataPortSchema, boolean>).properties as Record<
        string,
        any
      >;

      expect(properties).toHaveProperty("categories_1");
      expect(properties).toHaveProperty("message_1");
      expect(properties).toHaveProperty("categories_else");
      expect(properties).toHaveProperty("message_else");

      // buildConditionConfigOutput never emits `_activeBranches` in this mode.
      expect(properties).not.toHaveProperty("_activeBranches");
      // `conditionConfig` is control data, not a routed port.
      expect(properties).not.toHaveProperty("conditionConfig_1");

      // Each derived port reuses its input port's schema, so types survive.
      expect(properties.categories_1.type).toBe("array");
      expect(properties.categories_else.type).toBe("array");
      expect(properties.message_1.type).toBe("string");
    });

    it("omits the _else ports when the conditionConfig is not exclusive", () => {
      const task = new ConditionalTask({
        inputSchema: triageInputSchema,
        conditionConfig: {
          branches: [
            { id: "a", field: "score", operator: "greater_than", value: "0.8" },
            { id: "b", field: "score", operator: "less_or_equal", value: "0.8" },
          ],
          exclusive: false,
        },
      });

      const properties = (task.outputSchema() as Exclude<DataPortSchema, boolean>)
        .properties as Record<string, any>;

      expect(properties).toHaveProperty("categories_1");
      expect(properties).toHaveProperty("categories_2");
      expect(properties).not.toHaveProperty("categories_else");
      expect(properties).not.toHaveProperty("message_else");
    });

    it("keeps the function-branch output shape unchanged", () => {
      const task = new ConditionalTask({
        branches: [
          { id: "high", condition: (i: any) => i.value > 5, outputPort: "high" },
          { id: "low", condition: (i: any) => i.value <= 5, outputPort: "low" },
        ],
      });

      const schema = task.outputSchema() as Exclude<DataPortSchema, boolean>;
      const properties = schema.properties as Record<string, any>;

      expect(properties).toHaveProperty("_activeBranches");
      expect(properties).toHaveProperty("high");
      expect(properties).toHaveProperty("low");
      expect(schema.additionalProperties).toBe(false);
    });

    it("falls back to an open schema when the conditionConfig arrives only via the port", () => {
      const task = new ConditionalTask({});

      const schema = task.outputSchema() as Exclude<DataPortSchema, boolean>;

      // Nothing is derivable, so the schema must stay open — an open source port
      // resolves to "runtime" compatibility rather than "incompatible".
      expect(schema.additionalProperties).toBe(true);
      expect(Object.keys((schema.properties ?? {}) as Record<string, any>)).toHaveLength(0);
    });

    it("widens the declared input schema rather than replacing it", () => {
      const task = new ConditionalTask({
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          additionalProperties: false,
        },
        conditionConfig: triageConditionConfig,
      });

      const schema = task.inputSchema() as Exclude<DataPortSchema, boolean>;
      expect((schema.properties as Record<string, any>).message.type).toBe("string");
      // Forced open so no existing graph's input edge can regress to incompatible.
      expect(schema.additionalProperties).toBe(true);
    });

    it("reports per-port activation after a run", async () => {
      const task = new ConditionalTask({
        inputSchema: triageInputSchema,
        conditionConfig: triageConditionConfig,
      });

      await task.run({ score: 0.9, categories: ["billing"], message: "hello" });

      const status = task.getPortActiveStatus();
      expect(status.get("categories_1")).toBe(true);
      expect(status.get("message_1")).toBe(true);
      expect(status.get("categories_else")).toBe(false);
      expect(status.get("message_else")).toBe(false);
    });

    it("reports the else ports active when no branch matches", async () => {
      const task = new ConditionalTask({
        inputSchema: triageInputSchema,
        conditionConfig: triageConditionConfig,
      });

      await task.run({ score: 0.1, categories: ["billing"], message: "hello" });

      const status = task.getPortActiveStatus();
      expect(status.get("categories_1")).toBe(false);
      expect(status.get("categories_else")).toBe(true);
      expect(status.get("message_else")).toBe(true);
    });

    it("covers a declared input port that carried no data", async () => {
      const task = new ConditionalTask({
        inputSchema: triageInputSchema,
        conditionConfig: triageConditionConfig,
      });

      // `categories` is declared but never arrives.
      await task.run({ score: 0.1, message: "hello" });

      const status = task.getPortActiveStatus();
      // Present in the map at all: a port missing from it reads as "not a
      // branch port" and its edge is left enabled.
      expect(status.get("categories_1")).toBe(false);
      expect(status.get("categories_else")).toBe(true);
    });

    it("keeps an empty port of the TAKEN branch active", async () => {
      const task = new ConditionalTask({
        inputSchema: triageInputSchema,
        conditionConfig: triageConditionConfig,
      });

      await task.run({ score: 0.9, message: "hello" });

      const status = task.getPortActiveStatus();
      // Branch 1 matched, so its ports are active even where no data flowed —
      // activation belongs to the branch, not to the presence of a value.
      expect(status.get("categories_1")).toBe(true);
      expect(status.get("message_1")).toBe(true);
      expect(status.get("categories_else")).toBe(false);
    });

    it("is never cached: the routing decision lives in instance state", () => {
      expect(ConditionalTask.cacheable).toBe(false);
    });

    it("records the else ports as INACTIVE in non-exclusive mode, rather than omitting them", async () => {
      // Non-exclusive mode produces no `_else` output port. Absence and `false`
      // are NOT the same answer to the scheduler: a port missing from this map
      // is "not a branch port", so an edge wired off `score_else` stays
      // COMPLETED and delivers `undefined` downstream. Assert both that the key
      // is present and that its value is false — the presence is the bug.
      const task = new ConditionalTask({
        inputSchema: triageInputSchema,
        conditionConfig: { ...triageConditionConfig, exclusive: false },
      });

      await task.run({ score: 0.1, categories: ["billing"], message: "hello" });

      const status = task.getPortActiveStatus();
      expect(status.has("message_else")).toBe(true);
      expect(status.get("message_else")).toBe(false);
      // No branch matched, so the real branch port is inactive too.
      expect(status.get("message_1")).toBe(false);
    });

    it("keeps the else ports inactive in non-exclusive mode when a branch DOES match", async () => {
      const task = new ConditionalTask({
        inputSchema: triageInputSchema,
        conditionConfig: { ...triageConditionConfig, exclusive: false },
      });

      await task.run({ score: 0.9, categories: ["billing"], message: "hello" });

      const status = task.getPortActiveStatus();
      expect(status.get("message_1")).toBe(true);
      expect(status.get("message_else")).toBe(false);
    });
  });

  describe("cacheability is not overridable per instance", () => {
    // `Task.cacheable` lets `config.cacheable` / `runConfig.cacheable` win over
    // the class-static flag, so without the instance overrides a caller could
    // re-enable caching on a gate — and a cache hit never enters `execute`, so
    // the port-activation state the scheduler reads is never populated and the
    // graph mis-routes. Both readers are asserted because they are consulted by
    // different callers: `task.cacheable` by StreamPump / CacheCoordinator,
    // `getCachePolicy(inputs)` by TaskRunner.
    it("ignores a config.cacheable override", () => {
      const task = new ConditionalTask({ branches: [], cacheable: true });

      expect(task.cacheable).toBe(false);
      expect(task.getCachePolicy({}).kind).toBe("none");
    });

    it("ignores a runConfig.cacheable override", () => {
      const task = new ConditionalTask({ branches: [] }, { cacheable: true });

      expect(task.cacheable).toBe(false);
      expect(task.getCachePolicy({}).kind).toBe("none");
    });
  });
});
