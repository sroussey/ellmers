/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { CACHE_REGISTRY, type CacheRegistry, DefaultCacheRegistry } from "@workglow/task-graph";
import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { ServiceRegistry } from "@workglow/util";
import { describe, expect, it } from "vitest";

describe("CacheRegistry", () => {
  it("starts with both slots undefined", () => {
    const reg = new DefaultCacheRegistry();
    expect(reg.deterministic).toBeUndefined();
    expect(reg.private).toBeUndefined();
  });

  it("can be bound under the CACHE_REGISTRY service token", () => {
    const services = new ServiceRegistry();
    const reg: CacheRegistry = new DefaultCacheRegistry();
    reg.deterministic = new InMemoryTaskOutputRepository();
    services.registerInstance(CACHE_REGISTRY, reg);

    const got = services.get(CACHE_REGISTRY);
    expect(got).toBe(reg);
    expect(got.deterministic).toBeDefined();
    expect(got.private).toBeUndefined();
  });

  it("constructor seeds slots from init object", () => {
    const det = new InMemoryTaskOutputRepository();
    const priv = new InMemoryTaskOutputRepository();
    const reg = new DefaultCacheRegistry({ deterministic: det, private: priv });
    expect(reg.deterministic).toBe(det);
    expect(reg.private).toBe(priv);
  });
});
