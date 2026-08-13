/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { describe, expect, it } from "vitest";

describe("Repository durability", () => {
  it("in-memory repository is not durable", () => {
    expect(new InMemoryTaskOutputRepository().isDurable()).toBe(false);
  });
});
