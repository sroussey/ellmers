/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UIConditionConfig } from "@workglow/task-graph";
import { ConditionalTask } from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
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
});
