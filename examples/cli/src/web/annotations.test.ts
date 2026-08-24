/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { beforeEach, describe, expect, it } from "vitest";
import {
  annotateCommandTree,
  matchPathSpecificity,
  registerCommandAnnotation,
  registerCommandFieldAnnotations,
  resetWebAnnotationsForTesting,
  resolveCommandAnnotation,
  resolveFieldAnnotations,
} from "./annotations";
import { resolveCommandFields } from "./commandFields";
import { buildCommandTree, findCommandNode } from "./commandTree";

beforeEach(() => resetWebAnnotationsForTesting());

describe("path matching", () => {
  it("scores a literal match by how much of it is literal", () => {
    expect(matchPathSpecificity(["query", "facts"], ["query", "facts"])).toBe(2);
    expect(matchPathSpecificity(["query", "*"], ["query", "facts"])).toBe(1);
    expect(matchPathSpecificity(["query", "**"], ["query", "facts"])).toBe(1);
  });

  it("refuses a pattern that does not cover the whole path", () => {
    expect(matchPathSpecificity(["query"], ["query", "facts"])).toBe(-1);
    expect(matchPathSpecificity(["query", "facts"], ["query"])).toBe(-1);
    expect(matchPathSpecificity(["spac", "*"], ["query", "facts"])).toBe(-1);
  });

  it("matches the rest of a path with a trailing wildcard", () => {
    expect(matchPathSpecificity(["version", "**"], ["version", "coverage", "resolver"])).toBe(1);
    expect(matchPathSpecificity(["**"], ["anything", "at", "all"])).toBe(0);
  });
});

describe("command annotations", () => {
  it("unions the badges of every matching pattern", () => {
    registerCommandAnnotation({ path: ["sync", "**"], source: "sec", badges: ["network", "slow"] });
    registerCommandAnnotation({ path: ["sync", "spacs"], source: "sec", badges: ["ai"] });
    expect([...resolveCommandAnnotation(["sync", "spacs"]).badges].sort()).toEqual([
      "ai",
      "network",
      "slow",
    ]);
  });

  it("lets the more specific note and confirmation win", () => {
    registerCommandAnnotation({ path: ["db", "**"], source: "sec", note: "touches the database" });
    registerCommandAnnotation({
      path: ["db", "reset"],
      source: "sec",
      note: "drops every table this CLI owns",
      confirm: "This deletes stored data.",
    });
    const annotation = resolveCommandAnnotation(["db", "reset"]);
    expect(annotation.note).toBe("drops every table this CLI owns");
    expect(annotation.confirm).toBe("This deletes stored data.");
    // The group's note still applies where nothing more specific does.
    expect(resolveCommandAnnotation(["db", "status"]).confirm).toBeUndefined();
  });

  it("decorates a tree without disturbing a command nobody annotated", () => {
    registerCommandAnnotation({ path: ["db", "reset"], source: "sec", badges: ["destructive"] });
    const program = new Command();
    const db = program.command("db");
    db.command("reset").description("Drop tables");
    db.command("status").description("Report state");

    const tree = annotateCommandTree(buildCommandTree(program));
    expect(findCommandNode(tree, ["db", "reset"])?.badges).toEqual(["destructive"]);
    expect(findCommandNode(tree, ["db", "status"])?.badges).toBeUndefined();
    // Annotation is additive: the command's own reading of itself survives.
    expect(findCommandNode(tree, ["db", "status"])?.description).toBe("Report state");
  });
});

describe("field annotations", () => {
  it("gives a positional argument a picker the command could not declare", async () => {
    registerCommandFieldAnnotations({
      path: ["query", "**"],
      source: "sec",
      fields: { cik: { format: "sec:cik", placeholder: "name or CIK" } },
    });
    const program = new Command();
    program.command("query").command("facts").argument("<cik>", "Issuer CIK");

    const node = findCommandNode(buildCommandTree(program), ["query", "facts"]);
    const fields = await resolveCommandFields(node!, []);
    const cik = fields.find((field) => field.key === "cik");
    expect(cik?.format).toBe("sec:cik");
    expect(cik?.placeholder).toBe("name or CIK");
    expect(cik?.required).toBe(true);
    expect(cik?.source).toBe("argument");
  });

  it("annotates a flag, and turns a stated vocabulary into an enum", async () => {
    registerCommandFieldAnnotations({
      path: ["**"],
      source: "sec",
      fields: { format: { choices: ["table", "json", "csv"] } },
    });
    const program = new Command();
    program.command("entities").option("--format <format>", "Output format", "table");

    const node = findCommandNode(buildCommandTree(program), ["entities"]);
    const fields = await resolveCommandFields(node!, []);
    const format = fields.find((field) => field.key === "format");
    expect(format?.choices).toEqual(["table", "json", "csv"]);
    expect(format?.type).toBe("enum");
  });

  it("merges per key, most specific last", () => {
    registerCommandFieldAnnotations({
      path: ["**"],
      source: "sec",
      fields: { cik: { format: "sec:cik", description: "any filer" } },
    });
    registerCommandFieldAnnotations({
      path: ["spac", "report"],
      source: "sec",
      fields: { cik: { format: "sec:spac-cik" } },
    });
    const merged = resolveFieldAnnotations(["spac", "report"]);
    expect(merged.get("cik")).toEqual({ format: "sec:spac-cik", description: "any filer" });
  });

  it("leaves an unannotated command exactly as it was", async () => {
    const program = new Command();
    program.command("plain").argument("<name>", "A name");
    const node = findCommandNode(buildCommandTree(program), ["plain"]);
    const fields = await resolveCommandFields(node!, []);
    expect(fields[0].format).toBeUndefined();
    expect(fields[0].placeholder).toBeUndefined();
  });
});
