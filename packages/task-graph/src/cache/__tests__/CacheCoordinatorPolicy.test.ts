/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CacheCoordinator,
  DefaultCacheRegistry,
  Task,
  type CachePolicy,
} from "@workglow/task-graph";
import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { describe, expect, it } from "vitest";

class T extends Task {
  public static override type = "PolicyT";
}

async function freshRepo() {
  const r = new InMemoryTaskOutputRepository();
  await (r as any).setupDatabase?.();
  return r;
}

describe("CacheCoordinator policy routing", () => {
  it("kind: deterministic writes to deterministic slot only", async () => {
    const det = await freshRepo();
    const priv = await freshRepo();
    const reg = new DefaultCacheRegistry({ deterministic: det, private: priv });
    const c = new CacheCoordinator(new T());

    const policy: CachePolicy = { kind: "deterministic" };
    const k = await c.buildKeyForPolicy({ q: 1 } as any, reg, policy);
    await c.saveByPolicy(k, { r: 1 } as any, reg, policy);

    expect(await det.size()).toBe(1);
    expect(await priv.size()).toBe(0);
  });

  it("kind: private writes to private slot only", async () => {
    const det = await freshRepo();
    const priv = await freshRepo();
    const reg = new DefaultCacheRegistry({ deterministic: det, private: priv });
    const c = new CacheCoordinator(new T());

    const policy: CachePolicy = { kind: "private" };
    const k = await c.buildKeyForPolicy({ q: 1 } as any, reg, policy);
    await c.saveByPolicy(k, { r: 1 } as any, reg, policy);

    expect(await det.size()).toBe(0);
    expect(await priv.size()).toBe(1);
  });

  it("kind: private writes to private slot keyed by task id, not task type", async () => {
    const priv = await freshRepo();
    const reg = new DefaultCacheRegistry({ private: priv });
    const task = new T({ id: "node-abc" } as any);
    const c = new CacheCoordinator(task);

    const policy: CachePolicy = { kind: "private" };
    const k = await c.buildKeyForPolicy({ q: 1 } as any, reg, policy);
    await c.saveByPolicy(k, { r: 1 } as any, reg, policy);

    expect(await priv.getOutput("node-abc", k)).toEqual({ r: 1 });
    expect(await priv.getOutput(T.type, k)).toBeUndefined();
  });

  it("kind: none is a no-op", async () => {
    const det = await freshRepo();
    const priv = await freshRepo();
    const reg = new DefaultCacheRegistry({ deterministic: det, private: priv });
    const c = new CacheCoordinator(new T());

    const policy: CachePolicy = { kind: "none" };
    const k = await c.buildKeyForPolicy({ q: 1 } as any, reg, policy);
    await c.saveByPolicy(k, { r: 1 } as any, reg, policy);
    expect(await det.size()).toBe(0);
    expect(await priv.size()).toBe(0);
  });

  it("missing slot is silent no-op (does not throw)", async () => {
    const reg = new DefaultCacheRegistry({}); // both slots undefined
    const c = new CacheCoordinator(new T());
    const policy: CachePolicy = { kind: "deterministic" };

    const k = await c.buildKeyForPolicy({ q: 1 } as any, reg, policy);
    await expect(c.saveByPolicy(k, { r: 1 } as any, reg, policy)).resolves.toBeUndefined();
    expect(await c.lookupByPolicy(k, reg, policy, false, {} as any)).toBeUndefined();
  });

  it("undefined registry is silent no-op", async () => {
    const c = new CacheCoordinator(new T());
    const policy: CachePolicy = { kind: "deterministic" };
    const k = await c.buildKeyForPolicy({ q: 1 } as any, undefined, policy);
    await expect(c.saveByPolicy(k, { r: 1 } as any, undefined, policy)).resolves.toBeUndefined();
    expect(await c.lookupByPolicy(k, undefined, policy, false, {} as any)).toBeUndefined();
  });
});
