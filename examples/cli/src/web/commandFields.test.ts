/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  registerCommandSchemaProvider,
  resetCommandSchemaProvidersForTesting,
  resolveCommandFields,
} from "./commandFields";
import type { WebCommandNode } from "./commandTree";

const node: WebCommandNode = {
  path: ["task", "run"],
  name: "run",
  description: "",
  children: [],
  args: [
    { name: "type", description: "task type", required: true, variadic: false, choices: undefined },
  ],
  options: [
    {
      name: "dry-run",
      flags: "--dry-run",
      description: "Validate only",
      kind: "boolean",
      required: false,
      defaultValue: undefined,
      choices: undefined,
    },
  ],
};

afterEach(() => resetCommandSchemaProvidersForTesting());

describe("resolveCommandFields", () => {
  it("yields the argument, then schema fields, then flags", async () => {
    registerCommandSchemaProvider({
      path: ["task", "run"],
      resolve: async (args) =>
        args[0] === "TextGeneration"
          ? ({
              type: "object",
              properties: {
                prompt: { type: "string", title: "Prompt" },
                model: { type: "string", format: "model" },
              },
              required: ["prompt"],
            } as never)
          : undefined,
    });
    const fields = await resolveCommandFields(node, ["TextGeneration"]);
    expect(fields.map((f) => [f.key, f.source])).toEqual([
      ["type", "argument"],
      ["prompt", "schema"],
      ["model", "schema"],
      ["dry-run", "option"],
    ]);
    expect(fields[1].required).toBe(true);
    expect(fields[2].format).toBe("model");
  });

  it("degrades to arguments and flags for a command with no provider", async () => {
    const fields = await resolveCommandFields({ ...node, path: ["spac", "process"] }, ["2114227"]);
    expect(fields.map((f) => f.source)).toEqual(["argument", "option"]);
  });

  it("marks the flags the terminal treats as plumbing as advanced", async () => {
    const fields = await resolveCommandFields(node, []);
    expect(fields.find((f) => f.key === "dry-run")!.advanced).toBe(true);
  });

  it("keeps a schema field the terminal would not prompt for behind the fold", async () => {
    registerCommandSchemaProvider({
      path: ["task", "run"],
      resolve: async () =>
        ({
          type: "object",
          properties: {
            prompt: { type: "string" },
            temperature: { type: "number", default: 0.7 },
            secret: { type: "string", "x-ui-hidden": true },
          },
          required: ["prompt"],
        }) as never,
    });
    const fields = await resolveCommandFields(node, ["X"]);
    expect(fields.map((f) => f.key)).not.toContain("secret");
    expect(fields.find((f) => f.key === "temperature")).toMatchObject({
      advanced: true,
      defaultValue: 0.7,
    });
    expect(fields.find((f) => f.key === "prompt")!.advanced).toBe(false);
  });

  it("survives a provider that throws rather than losing the whole form", async () => {
    registerCommandSchemaProvider({
      path: ["task", "run"],
      resolve: async () => {
        throw new Error("registry not ready");
      },
    });
    const fields = await resolveCommandFields(node, ["X"]);
    expect(fields.map((f) => f.source)).toEqual(["argument", "option"]);
  });
});
