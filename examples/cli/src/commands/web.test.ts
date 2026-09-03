/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { consoleRoot } from "./web";

describe("consoleRoot", () => {
  it("is the command itself when web is registered on the root", () => {
    const program = new Command("tool");
    expect(consoleRoot(program)).toBe(program);
  });

  it("climbs to the root when web is filed under a group", () => {
    // `setup web` must still serve the whole tree under the binary's name,
    // not `setup`'s children under the name "setup".
    const program = new Command("tool");
    const setup = program.command("setup");
    const nested = setup.command("nested");
    expect(consoleRoot(setup)).toBe(program);
    expect(consoleRoot(nested)).toBe(program);
    expect(consoleRoot(nested).name()).toBe("tool");
  });
});
