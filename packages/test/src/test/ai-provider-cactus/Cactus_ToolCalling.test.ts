/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { _testOnly } from "@workglow/cactus/ai";
import { afterEach, describe, expect, it } from "vitest";
import { runFnFor } from "./test-utils";

const { cactusEngines } = _testOnly;
const Cactus_ToolCalling = runFnFor(["tool-use"]);

const tools = [
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

const model = {
  model_id: "test",
  title: "",
  description: "",
  provider: "LOCAL_CACTUS",
  provider_config: { model_id: "needle-26m" },
  capabilities: ["tool-use"],
  metadata: {},
};

afterEach(() => {
  cactusEngines.clear();
});

async function collectToolCallNames(engine: {
  run: (q: string, t: string) => string;
}): Promise<string[]> {
  cactusEngines.set("needle-26m", engine as never);
  const names: string[] = [];
  const controller = new AbortController();
  await Cactus_ToolCalling(
    { prompt: "What's the weather in Paris?", tools, toolChoice: "auto" } as never,
    model as never,
    controller.signal,
    (ev) => {
      if (ev.type === "object-delta" && ev.port === "toolCalls") {
        for (const call of ev.objectDelta as Array<{ name: string }>) {
          names.push(call.name);
        }
      }
    }
  );
  return names;
}

describe("Cactus_ToolCalling output parsing", () => {
  it("parses a v1 bare JSON tool-call array", async () => {
    const names = await collectToolCallNames({
      run: () => JSON.stringify([{ name: "lookup_weather", arguments: { city: "Paris" } }]),
    });
    expect(names).toEqual(["lookup_weather"]);
  });

  it("parses a v2 <tool_call>-wrapped JSON payload", async () => {
    const names = await collectToolCallNames({
      run: () => `<tool_call>[{"name":"lookup_weather","arguments":{"city":"Paris"}}]</tool_call>`,
    });
    expect(names).toEqual(["lookup_weather"]);
  });

  it("treats an empty v2 tool_call payload as no calls", async () => {
    const names = await collectToolCallNames({
      run: () => `<tool_call>[]</tool_call>`,
    });
    expect(names).toEqual([]);
  });
});
