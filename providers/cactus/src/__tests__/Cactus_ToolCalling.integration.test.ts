/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cactusConfigJson, cactusEngines } from "../ai/common/Cactus_Runtime";
import { Cactus_ToolCalling } from "../ai/common/Cactus_ToolCalling";

const RUN = process.env.RUN_CACTUS_TESTS === "1";

const tools = [
  {
    name: "book_flight",
    description: "Book a flight between two cities on a date",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string" },
        destination: { type: "string" },
        date: { type: "string" },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "lookup_weather",
    description: "Look up the weather for a city",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
];

describe.skipIf(!RUN)("Cactus_ToolCalling (integration)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cactus-toolcalling-"));
  });

  afterAll(() => {
    cactusEngines.clear();
    cactusConfigJson.clear();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a tool call from a tool-routing prompt", async () => {
    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const controller = new AbortController();
    await Cactus_ToolCalling(
      {
        prompt: "Book a flight from London to JFK tomorrow",
        tools,
        toolChoice: "auto",
      } as any,
      {
        model_id: "test",
        title: "",
        description: "",
        provider: "LOCAL_CACTUS",
        provider_config: { model_id: "needle-26m", models_dir: dir },
        capabilities: ["tool-use"],
        metadata: {},
      } as any,
      controller.signal,
      (ev) => {
        if (ev.type === "object-delta" && ev.port === "toolCalls") {
          for (const c of ev.objectDelta as Array<{
            name: string;
            input: Record<string, unknown>;
          }>) {
            toolCalls.push(c);
          }
        }
      }
    );
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(["book_flight", "lookup_weather"]).toContain(toolCalls[0].name);
  }, 180_000);
});
