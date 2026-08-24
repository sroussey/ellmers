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

  /**
   * `**` means "the rest", so a segment after it is one the author expected to
   * constrain the match and that nothing can honor. Matching anyway would apply
   * the annotation far wider than the pattern reads; matching nothing is caught
   * by the guard that every registered pattern must reach a real command.
   */
  it("refuses a `**` that is not the last segment", () => {
    expect(matchPathSpecificity(["a", "**", "b"], ["a", "b"])).toBe(-1);
    expect(matchPathSpecificity(["a", "**", "b"], ["a", "x", "b"])).toBe(-1);
    expect(matchPathSpecificity(["a", "**", "b"], ["a", "anything", "at", "all"])).toBe(-1);
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

  /**
   * A downstream re-registers the same paths on purpose: a superset that adds
   * commands after the base CLI's registration pass has to re-run it over the
   * fuller tree, which re-states every path the first pass already covered.
   * Replacing rather than appending is what makes that safe, so it is asserted
   * rather than left to the reader of the two-line function.
   */
  it("replaces an annotation registered again for the same path", () => {
    registerCommandAnnotation({ path: ["db", "reset"], source: "sec", badges: ["writes"] });
    registerCommandAnnotation({
      path: ["db", "reset"],
      source: "sec",
      badges: ["destructive"],
      confirm: "This drops tables.",
    });
    const annotation = resolveCommandAnnotation(["db", "reset"]);
    // Not a union with the superseded registration: the second call is the
    // whole truth about that path, so the earlier `writes` is gone.
    expect(annotation.badges).toEqual(["destructive"]);
    expect(annotation.confirm).toBe("This drops tables.");
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

  /**
   * The same property on the field side, which the format re-run relies on.
   *
   * The second registration DROPS a key the first had, which is the only shape
   * that distinguishes replace from append here: two entries at one path merge
   * in registration order, so a re-registration that merely changes a value
   * looks identical either way — it is the field the re-run no longer claims
   * that an appended duplicate would resurrect.
   */
  it("replaces field annotations registered again for the same path", () => {
    registerCommandFieldAnnotations({
      path: ["query", "entities"],
      source: "sec",
      fields: { format: { choices: ["table"] }, cik: { format: "sec:cik" } },
    });
    registerCommandFieldAnnotations({
      path: ["query", "entities"],
      source: "sec",
      fields: { format: { choices: ["table", "json", "csv"] } },
    });
    const merged = resolveFieldAnnotations(["query", "entities"]);
    expect(merged.get("format")?.choices).toEqual(["table", "json", "csv"]);
    expect(merged.get("cik")).toBeUndefined();
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
