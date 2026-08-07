/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CacheCoordinator, Task } from "@workglow/task-graph";
import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { describe, expect, it } from "vitest";

describe("CacheCoordinator key with version", () => {
  it("bumping task.version invalidates cache hits", async () => {
    class V1 extends Task {
      public static override type = "V";
      public static override version = 1;
    }
    class V2 extends Task {
      public static override type = "V";
      public static override version = 2;
    }

    const repo = new InMemoryTaskOutputRepository();
    await (repo as any).setupDatabase?.();

    const v1 = new V1();
    const v2 = new V2();
    const coordV1 = new CacheCoordinator(v1);
    const coordV2 = new CacheCoordinator(v2);

    const input = { q: "hello" };
    const key1 = await coordV1.buildKey(input as any, repo);
    await coordV1.save(key1, { r: "v1-result" } as any, repo, { kind: "deterministic" });

    expect(await coordV1.lookup(key1, repo, { kind: "deterministic" }, false, {} as any)).toEqual({
      r: "v1-result",
    });

    const key2 = await coordV2.buildKey(input as any, repo);
    expect(
      await coordV2.lookup(key2, repo, { kind: "deterministic" }, false, {} as any)
    ).toBeUndefined();
  });

  it("identical version + inputs still hit cache", async () => {
    class Stable extends Task {
      public static override type = "Stable";
      public static override version = 7;
    }
    const repo = new InMemoryTaskOutputRepository();
    await (repo as any).setupDatabase?.();
    const c = new CacheCoordinator(new Stable());

    const key = await c.buildKey({ q: "x" } as any, repo);
    await c.save(key, { r: "hit" } as any, repo, { kind: "deterministic" });
    expect(await c.lookup(key, repo, { kind: "deterministic" }, false, {} as any)).toEqual({
      r: "hit",
    });
  });
});
