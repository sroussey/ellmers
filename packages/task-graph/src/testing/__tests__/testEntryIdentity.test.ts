/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskOutputTabularRepository } from "@workglow/task-graph";
import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { describe, expect, it } from "vitest";

/**
 * A test double in the `./test` bundle must extend the SAME base class the rest
 * of the code uses.
 *
 * `./test` is built by its own `bun build --packages=external` pass. Importing
 * the base relatively (`../storage/TaskOutputTabularRepository`) inlines a second
 * copy of it into this bundle, and instances then fail `instanceof` against the
 * class every consumer holds — a failure that only shows up in dist mode, and
 * shows up as a type-shaped bug rather than an import error.
 *
 * Both sides are imported by package specifier because that is what a consumer
 * does; a relative import on either side would compare source against `dist`.
 */
describe("@workglow/task-graph/test entry", () => {
  it("subclasses the same base class the public entry exports", () => {
    expect(new InMemoryTaskOutputRepository()).toBeInstanceOf(TaskOutputTabularRepository);
  });

  it("produces a usable repository", async () => {
    const repo = new InMemoryTaskOutputRepository();
    await repo.saveOutput("SomeTask", { a: 1 }, { result: "ok" });
    expect(await repo.getOutput("SomeTask", { a: 1 })).toEqual({ result: "ok" });
  });
});
