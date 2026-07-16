/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CheckpointEntry, ModelConfig } from "@workglow/ai";
import {
  CAPABILITIES,
  checkpointModelKey,
  clearCheckpointsForTesting,
  deleteCheckpoint,
  getCheckpoint,
  registerCheckpoint,
} from "@workglow/ai";
import { beforeEach, describe, expect, it } from "vitest";

describe("cache.checkpoint capability", () => {
  it("is a recognized capability", () => {
    expect(CAPABILITIES["cache.checkpoint"]).toBeDefined();
  });
});

describe("CheckpointRegistry", () => {
  beforeEach(() => {
    clearCheckpointsForTesting();
  });

  const entry: CheckpointEntry = {
    provider: "TEST_PROVIDER",
    modelKey: "test:model:v1",
    prefix: {
      systemPrompt: "You are helpful.",
      tools: [{ name: "a", description: "A", inputSchema: { type: "object" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    },
  };

  it("registers and retrieves an entry", () => {
    registerCheckpoint("ckpt-1", entry);
    expect(getCheckpoint("ckpt-1")).toEqual(entry);
  });

  it("returns undefined for unknown ids", () => {
    expect(getCheckpoint("nope")).toBeUndefined();
  });

  it("deletes entries", () => {
    registerCheckpoint("ckpt-1", entry);
    expect(deleteCheckpoint("ckpt-1")).toBe(true);
    expect(getCheckpoint("ckpt-1")).toBeUndefined();
    expect(deleteCheckpoint("ckpt-1")).toBe(false);
  });

  it("checkpointModelKey uses model_id and falls back to empty string", () => {
    expect(checkpointModelKey({ model_id: "m1" } as unknown as ModelConfig)).toBe("m1");
    expect(checkpointModelKey({} as ModelConfig)).toBe("");
  });
});
