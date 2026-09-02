/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildCommandTree, findCommandNode } from "./commandTree";

function fixture(): Command {
  const program = new Command();
  const spac = program.command("spac").description("Issuer lifecycle");
  spac
    .command("process")
    .description("Replay a timeline")
    .argument("<cik>", "issuer CIK")
    .option("--force", "re-run recorded steps")
    .option("--from <date>", "lower bound", "2020-01-01");
  spac.command("backfill").description("Recover").command("despac").description("Refresh identity");
  program.command("secret", { hidden: true }).description("not for humans");
  return program;
}

describe("buildCommandTree", () => {
  it("nests sub-commands to any depth", () => {
    const [spac] = buildCommandTree(fixture());
    expect(spac.name).toBe("spac");
    expect(spac.children.map((c) => c.name)).toEqual(["process", "backfill"]);
    expect(spac.children[1].children[0].path).toEqual(["spac", "backfill", "despac"]);
  });

  it("carries the arguments and options the page has to render", () => {
    const process = buildCommandTree(fixture())[0].children[0];
    expect(process.args).toEqual([
      {
        name: "cik",
        description: "issuer CIK",
        required: true,
        variadic: false,
        choices: undefined,
      },
    ]);
    const byName = Object.fromEntries(process.options.map((o) => [o.name, o]));
    expect(byName["force"].kind).toBe("boolean");
    expect(byName["from"]).toMatchObject({ kind: "value", defaultValue: "2020-01-01" });
  });

  it("omits help and hidden commands — neither is a thing to run here", () => {
    const names = buildCommandTree(fixture()).map((c) => c.name);
    expect(names).not.toContain("help");
    expect(names).not.toContain("secret");
    const process = buildCommandTree(fixture())[0].children[0];
    expect(process.options.map((o) => o.name)).not.toContain("help");
  });

  it("omits web — the console is already that command", () => {
    const program = fixture();
    program.command("web").description("Serve a local web console");
    const names = buildCommandTree(program).map((c) => c.name);
    expect(names).not.toContain("web");
    expect(names).toContain("spac");
  });
});

describe("findCommandNode", () => {
  it("walks a path of any depth", () => {
    const tree = buildCommandTree(fixture());
    expect(findCommandNode(tree, ["spac", "backfill", "despac"])?.name).toBe("despac");
    expect(findCommandNode(tree, ["spac", "nope"])).toBeUndefined();
    expect(findCommandNode(tree, [])).toBeUndefined();
  });
});
