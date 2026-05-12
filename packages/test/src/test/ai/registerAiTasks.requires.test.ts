/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CAPABILITIES, type Capability, registerAiTasks } from "@workglow/ai";
import { describe, expect, it } from "vitest";

describe("AI task requires audit", () => {
  it("every registered task declares a static requires array of valid capabilities", () => {
    const tasks = registerAiTasks();
    const validCapabilities = new Set(Object.keys(CAPABILITIES));
    const failures: string[] = [];

    for (const TaskClass of tasks) {
      const requires = TaskClass.requires;
      if (!Array.isArray(requires)) {
        failures.push(`${TaskClass.name}: requires is not an array`);
        continue;
      }
      for (const cap of requires) {
        if (!validCapabilities.has(cap)) {
          failures.push(`${TaskClass.name}: requires "${cap}" not in CAPABILITIES`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("at least one task declares each provider-facing capability we care about", () => {
    // Sanity check: capabilities that should appear on at least one task today.
    // Lists capabilities that have at least one concrete task (excluding pure-compute and
    // capabilities that are only registered server-side without a corresponding task).
    const tasks = registerAiTasks();
    const seen = new Set<Capability>();
    for (const TaskClass of tasks) {
      const requires = TaskClass.requires;
      for (const cap of requires) seen.add(cap);
    }
    const expected: Capability[] = [
      "text.generation",
      "text.embedding",
      "image.generation",
      "vision.face-detection",
      "model.count-tokens",
      "model.search",
    ];
    for (const cap of expected) {
      expect(seen.has(cap), `expected at least one task with ${cap}`).toBe(true);
    }
  });
});
