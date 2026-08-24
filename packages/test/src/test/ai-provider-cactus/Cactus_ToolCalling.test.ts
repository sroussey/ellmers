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

async function runToolCalling(engine: {
  run: (q: string, t: string) => string | Promise<string>;
  run_json?: (q: string, t: string) => string | Promise<string>;
  run_stream?: (
    q: string,
    t: string,
    cb: (tokenIdOrChunk: number | string, piece?: string) => void
  ) => string | Promise<string>;
}): Promise<{ names: string[]; textDeltas: string[]; finishText: string }> {
  cactusEngines.set("needle-26m", engine as never);
  const names: string[] = [];
  const textDeltas: string[] = [];
  let finishText = "";
  const controller = new AbortController();
  await Cactus_ToolCalling(
    { prompt: "What's the weather in Paris?", tools, toolChoice: "auto" } as never,
    model as never,
    controller.signal,
    (ev) => {
      if (ev.type === "text-delta" && ev.port === "text") {
        textDeltas.push(ev.textDelta);
      }
      if (ev.type === "object-delta" && ev.port === "toolCalls") {
        for (const call of ev.objectDelta as Array<{ name: string }>) {
          names.push(call.name);
        }
      }
      if (ev.type === "finish") {
        finishText = ev.data.text;
      }
    }
  );
  return { names, textDeltas, finishText };
}

describe("Cactus_ToolCalling output parsing", () => {
  it("parses a v1 bare JSON tool-call array", async () => {
    const { names } = await runToolCalling({
      run: () => JSON.stringify([{ name: "lookup_weather", arguments: { city: "Paris" } }]),
    });
    expect(names).toEqual(["lookup_weather"]);
  });

  it("parses a v2 <tool_call>-wrapped JSON payload", async () => {
    const { names } = await runToolCalling({
      run: () => `<tool_call>[{"name":"lookup_weather","arguments":{"city":"Paris"}}]</tool_call>`,
    });
    expect(names).toEqual(["lookup_weather"]);
  });

  it("treats an empty v2 tool_call payload as no calls", async () => {
    const { names } = await runToolCalling({
      run: () => `<tool_call>[]</tool_call>`,
    });
    expect(names).toEqual([]);
  });

  it("uses run() fallback when only run_json is exposed", async () => {
    const { names, finishText } = await runToolCalling({
      run: () => `<tool_call>[{"name":"lookup_weather","arguments":{"city":"Paris"}}]</tool_call>`,
      run_json: () => `<tool_call>[]</tool_call>`,
    });
    expect(names).toEqual(["lookup_weather"]);
    expect(finishText).toContain("lookup_weather");
  });

  it("accepts v2 run_stream(tokenId, piece) callback shape", async () => {
    const { names, textDeltas } = await runToolCalling({
      run: () => "unused",
      run_stream: async (_q, _t, cb) => {
        cb(0, "<tool_call>[");
        cb(1, '{"name":"lookup_weather","arguments":{"city":"Paris"}}');
        cb(2, "]</tool_call>");
        return `<tool_call>[{"name":"lookup_weather","arguments":{"city":"Paris"}}]</tool_call>`;
      },
    });
    expect(names).toEqual(["lookup_weather"]);
    expect(textDeltas.join("")).toContain("lookup_weather");
  });
});
