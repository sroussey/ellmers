/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Container, createServiceToken, ServiceRegistry } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

describe("ServiceRegistry", () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry(new Container());
  });

  describe("createServiceToken", () => {
    it("should create a token with an id", () => {
      const token = createServiceToken<string>("test.token");
      expect(token.id).toBe("test.token");
    });
  });

  describe("register and get", () => {
    it("should register a factory and retrieve the service", () => {
      const token = createServiceToken<{ name: string }>("svc");
      registry.register(token, () => ({ name: "hello" }));
      const result = registry.get(token);
      expect(result.name).toBe("hello");
    });

    it("should return singleton by default", () => {
      const token = createServiceToken<{ value: number }>("singleton");
      let count = 0;
      registry.register(token, () => ({ value: ++count }));
      const a = registry.get(token);
      const b = registry.get(token);
      expect(a).toBe(b);
      expect(count).toBe(1);
    });
  });

  describe("registerInstance", () => {
    it("should register an instance directly", () => {
      const token = createServiceToken<string>("instance");
      registry.registerInstance(token, "hello");
      expect(registry.get(token)).toBe("hello");
    });
  });

  describe("registerIfAbsent", () => {
    it("should register when token is absent", () => {
      const token = createServiceToken<{ value: string }>("absent");
      registry.registerIfAbsent(token, () => ({ value: "first" }));
      expect(registry.has(token)).toBe(true);
      expect(registry.get(token).value).toBe("first");
    });

    it("should not overwrite an existing registration", () => {
      const token = createServiceToken<{ value: string }>("existing");
      registry.register(token, () => ({ value: "original" }));
      registry.registerIfAbsent(token, () => ({ value: "duplicate" }));
      expect(registry.get(token).value).toBe("original");
    });
  });

  describe("has", () => {
    it("should return false when service is not registered", () => {
      const token = createServiceToken<string>("missing");
      expect(registry.has(token)).toBe(false);
    });

    it("should return true when service is registered", () => {
      const token = createServiceToken<string>("present");
      registry.register(token, () => "value");
      expect(registry.has(token)).toBe(true);
    });
  });
});
