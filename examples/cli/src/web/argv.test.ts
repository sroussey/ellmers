/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { composeArgv, renderCliLine, validateInvocation, type WebInvocation } from "./argv";
import type { WebCommandNode } from "./commandTree";

const invocation: WebInvocation = {
  path: ["workflow", "run"],
  args: ["chat-sample"],
  options: { prompt: "Draft a note", model: "claude-sonnet-5", "dry-run": true, quiet: false },
};

describe("composeArgv", () => {
  it("puts the path first, then positionals, then flags", () => {
    expect(composeArgv(invocation)).toEqual([
      "workflow",
      "run",
      "chat-sample",
      "--prompt",
      "Draft a note",
      "--model",
      "claude-sonnet-5",
      "--dry-run",
    ]);
  });

  it("passes a value through untouched — argv needs no shell quoting", () => {
    expect(composeArgv({ path: ["x"], args: [], options: { p: 'a "b" c' } })).toEqual([
      "x",
      "--p",
      'a "b" c',
    ]);
  });
});

describe("renderCliLine", () => {
  it("quotes only what a shell would need quoted", () => {
    expect(renderCliLine("workglow", invocation)).toBe(
      'workglow workflow run chat-sample --prompt "Draft a note" --model claude-sonnet-5 --dry-run'
    );
  });

  it("escapes a quote rather than ending the string early", () => {
    expect(renderCliLine("w", { path: ["x"], args: [], options: { p: 'say "hi"' } })).toBe(
      'w x --p "say \\"hi\\""'
    );
  });
});

const node: WebCommandNode = {
  path: ["workflow", "run"],
  name: "run",
  description: "",
  children: [],
  args: [{ name: "id", description: "", required: true, variadic: false, choices: undefined }],
  options: [
    {
      name: "model",
      flags: "--model <id>",
      description: "",
      kind: "value",
      required: false,
      defaultValue: undefined,
      choices: ["a", "b"],
    },
    {
      name: "force",
      flags: "--force",
      description: "",
      kind: "boolean",
      required: false,
      defaultValue: undefined,
      choices: undefined,
    },
  ],
};

describe("validateInvocation", () => {
  it("reports a missing required argument", () => {
    expect(validateInvocation(node, { path: node.path, args: [], options: {} })).toEqual([
      "id is required",
    ]);
  });

  it("refuses an option the command does not declare", () => {
    expect(
      validateInvocation(node, { path: node.path, args: ["x"], options: { nope: "1" } })
    ).toEqual(['unknown option "nope"']);
  });

  it("refuses a value outside the declared choices", () => {
    expect(
      validateInvocation(node, { path: node.path, args: ["x"], options: { model: "c" } })
    ).toEqual(["model must be one of a, b"]);
  });

  it("refuses a value on a flag and a flag with no value", () => {
    expect(
      validateInvocation(node, { path: node.path, args: ["x"], options: { force: "yes" } })
    ).toEqual(["force is a flag and takes no value"]);
    expect(
      validateInvocation(node, { path: node.path, args: ["x"], options: { model: true } })
    ).toEqual(["model needs a value"]);
  });

  it("accepts a complete invocation", () => {
    expect(
      validateInvocation(node, {
        path: node.path,
        args: ["x"],
        options: { model: "a", force: true },
      })
    ).toEqual([]);
  });
});
