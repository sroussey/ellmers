/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { WebField } from "../commandFields";
import {
  formErrors,
  initialValues,
  splitFields,
  toInvocation,
  valuesFromInvocation,
} from "./formModel";

const field = (over: Partial<WebField> & { key: string }): WebField => ({
  label: over.key,
  description: "",
  type: "string",
  format: undefined,
  required: false,
  advanced: false,
  defaultValue: undefined,
  choices: undefined,
  source: "schema",
  ...over,
});

const fields: readonly WebField[] = [
  field({ key: "type", source: "argument", required: true }),
  field({ key: "prompt", required: true }),
  field({ key: "model", defaultValue: "claude-sonnet-5" }),
  field({ key: "delay", source: "config", advanced: true }),
  field({ key: "dry-run", type: "boolean", source: "option", advanced: true }),
];

describe("initialValues", () => {
  it("seeds defaults and leaves everything else unset", () => {
    expect(initialValues(fields)).toEqual({ model: "claude-sonnet-5", "dry-run": false });
  });
});

describe("valuesFromInvocation", () => {
  const aliasFields: readonly WebField[] = [
    field({ key: "from", source: "argument", required: true }),
    field({ key: "into", source: "argument", required: true }),
    field({ key: "reason", source: "option" }),
    field({ key: "format", source: "option", defaultValue: "text" }),
  ];

  it("fills arguments in declared order and options by key", () => {
    expect(
      valuesFromInvocation(aliasFields, {
        path: ["review", "aliases", "company", "add"],
        args: ["ACME CORP", "ACME CORP."],
        options: { reason: "EDGAR carried both" },
      })
    ).toEqual({
      from: "ACME CORP",
      into: "ACME CORP.",
      reason: "EDGAR carried both",
      format: "text",
    });
  });

  it("round-trips an invocation the form composed", () => {
    const invocation = toInvocation(
      aliasFields,
      { from: "A", into: "B", reason: "typo", format: "text" },
      ["review", "aliases", "company", "add"]
    );
    const values = valuesFromInvocation(aliasFields, invocation);
    expect(toInvocation(aliasFields, values, invocation.path)).toEqual(invocation);
  });

  it("leaves a field the invocation does not mention at its default", () => {
    expect(
      valuesFromInvocation(aliasFields, {
        path: ["review", "aliases", "company", "add"],
        args: ["A"],
        options: {},
      })
    ).toEqual({ from: "A", format: "text" });
  });
});

describe("toInvocation", () => {
  it("puts arguments in order and everything else in its own namespace", () => {
    const invocation = toInvocation(
      fields,
      { type: "Delay", prompt: "hi", model: "claude-sonnet-5", delay: "600", "dry-run": true },
      ["task", "run"]
    );
    expect(invocation).toEqual({
      path: ["task", "run"],
      args: ["Delay"],
      options: { prompt: "hi", "dry-run": true },
      config: { delay: "600" },
    });
  });

  it("drops a value equal to the command's own default", () => {
    const invocation = toInvocation(fields, { type: "X", model: "claude-sonnet-5" }, [
      "task",
      "run",
    ]);
    expect(invocation.options).toEqual({});
  });

  it("keeps a value that differs from the default", () => {
    const invocation = toInvocation(fields, { type: "X", model: "gpt-5.5" }, ["task", "run"]);
    expect(invocation.options).toEqual({ model: "gpt-5.5" });
  });

  it("omits config entirely when nothing set it", () => {
    expect(toInvocation(fields, { type: "X" }, ["task", "run"]).config).toBeUndefined();
  });
});

describe("formErrors", () => {
  it("names the required fields still empty", () => {
    expect(formErrors(fields, { type: "Delay" })).toEqual(["prompt is required"]);
    expect(formErrors(fields, { type: "Delay", prompt: "hi" })).toEqual([]);
  });
});

describe("splitFields", () => {
  it("separates arguments, the fields worth showing, and the fold", () => {
    const split = splitFields(fields);
    expect(split.args.map((f) => f.key)).toEqual(["type"]);
    expect(split.inputs.map((f) => f.key)).toEqual(["prompt", "model"]);
    expect(split.advanced.map((f) => f.key)).toEqual(["delay", "dry-run"]);
  });
});
