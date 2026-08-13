/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageValue } from "@workglow/util/media";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, type Capability } from "../capability/Capabilities";
import type { AiTask } from "./base/AiTask";
import type { ImageEmbeddingTaskInput } from "./ImageEmbeddingTask";
import { registerAiTasks } from "./index";
import { StructuredGenerationTask } from "./StructuredGenerationTask";
import { ToolCallingTask } from "./ToolCallingTask";

const imageEmbeddingInputImageIsTyped: ImageEmbeddingTaskInput["image"] extends
  ImageValue | readonly ImageValue[]
  ? true
  : false = true;

describe("AI task requires audit", () => {
  it("infers image embedding input image as ImageValue or ImageValue[]", () => {
    expect(imageEmbeddingInputImageIsTyped).toBe(true);
  });

  it("every registered task declares a static requires array of valid capabilities", () => {
    const tasks = registerAiTasks();
    const validCapabilities = new Set(Object.keys(CAPABILITIES));
    const failures: string[] = [];

    for (const TaskClass of tasks) {
      const requires = (TaskClass as typeof AiTask).requires;
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
      const requires = (TaskClass as typeof AiTask).requires;
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

describe("ToolCallingTask.requires (post-relaxation)", () => {
  it("requires exactly ['tool-use']", () => {
    expect([...ToolCallingTask.requires]).toEqual(["tool-use"]);
  });

  it("is satisfied by a tool-only model (capabilities: ['tool-use'])", () => {
    const required = new Set(ToolCallingTask.requires);
    const have = new Set(["tool-use"]);
    expect([...required].every((c) => have.has(c))).toBe(true);
  });

  it("is satisfied by a chat-LLM model (capabilities: ['text.generation', 'tool-use'])", () => {
    const required = new Set(ToolCallingTask.requires);
    const have = new Set(["text.generation", "tool-use"]);
    expect([...required].every((c) => have.has(c))).toBe(true);
  });
});

describe("StructuredGenerationTask.requires (post-relaxation)", () => {
  it("requires exactly ['json-mode']", () => {
    expect([...StructuredGenerationTask.requires]).toEqual(["json-mode"]);
  });
});
