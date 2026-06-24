/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Container } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

describe("Container", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe("register and get", () => {
    it("should register and retrieve a singleton service", () => {
      let callCount = 0;
      container.register("counter", () => {
        callCount++;
        return { value: callCount };
      });

      const first = container.get("counter");
      const second = container.get("counter");
      expect(first).toBe(second);
      expect(callCount).toBe(1);
    });

    it("should create new instances for non-singleton services", () => {
      let callCount = 0;
      container.register(
        "transient",
        () => {
          callCount++;
          return { value: callCount };
        },
        false
      );

      const first = container.get<{ value: number }>("transient");
      const second = container.get<{ value: number }>("transient");
      expect(first).not.toBe(second);
      expect(first.value).toBe(1);
      expect(second.value).toBe(2);
    });

    it("should throw for unregistered service", () => {
      expect(() => container.get("unknown")).toThrow("Service not registered: unknown");
    });

    it("should honor re-registration after a singleton was instantiated", () => {
      container.register("svc", () => ({ value: "first" }));
      // Force instantiation so the instance is cached in services.
      expect(container.get<{ value: string }>("svc").value).toBe("first");

      // Re-register with a new factory; the new factory must take effect.
      container.register("svc", () => ({ value: "second" }));
      expect(container.get<{ value: string }>("svc").value).toBe("second");
    });

    it("should drop the singleton flag when re-registering as transient", () => {
      container.register("svc", () => ({ value: "first" }));
      container.get("svc");

      let callCount = 0;
      container.register(
        "svc",
        () => {
          callCount++;
          return { value: callCount };
        },
        false
      );

      const a = container.get<{ value: number }>("svc");
      const b = container.get<{ value: number }>("svc");
      expect(a).not.toBe(b);
      expect(callCount).toBe(2);
    });
  });

  describe("registerInstance", () => {
    it("should register and retrieve an instance directly", () => {
      const instance = { name: "test" };
      container.registerInstance("myService", instance);
      expect(container.get("myService")).toBe(instance);
    });

    it("should always return the same instance", () => {
      const instance = { name: "test" };
      container.registerInstance("myService", instance);
      expect(container.get("myService")).toBe(container.get("myService"));
    });
  });

  describe("has", () => {
    it("should return false for unregistered service", () => {
      expect(container.has("unknown")).toBe(false);
    });

    it("should return true for registered factory", () => {
      container.register("svc", () => ({}));
      expect(container.has("svc")).toBe(true);
    });

    it("should return true for registered instance", () => {
      container.registerInstance("svc", {});
      expect(container.has("svc")).toBe(true);
    });
  });

  describe("remove", () => {
    it("should remove a registered service", () => {
      container.register("svc", () => ({}));
      expect(container.has("svc")).toBe(true);
      container.remove("svc");
      expect(container.has("svc")).toBe(false);
    });

    it("should remove an instance service", () => {
      container.registerInstance("svc", { x: 1 });
      container.remove("svc");
      expect(container.has("svc")).toBe(false);
    });
  });

  describe("registerIfAbsent", () => {
    it("should register when token is absent", () => {
      container.registerIfAbsent("svc", () => ({ value: "first" }));
      expect(container.has("svc")).toBe(true);
      expect(container.get<{ value: string }>("svc").value).toBe("first");
    });

    it("should not overwrite an existing factory", () => {
      container.register("svc", () => ({ value: "original" }));
      container.registerIfAbsent("svc", () => ({ value: "duplicate" }));
      expect(container.get<{ value: string }>("svc").value).toBe("original");
    });

    it("should not overwrite an existing instance", () => {
      container.registerInstance("svc", { value: "instance" });
      container.registerIfAbsent("svc", () => ({ value: "factory" }));
      expect(container.get<{ value: string }>("svc").value).toBe("instance");
    });
  });

  describe("circular dependency detection", () => {
    it("should throw on reentrant get for the same singleton token", () => {
      container.register("circular", () => {
        return container.get("circular");
      });
      expect(() => container.get("circular")).toThrow(
        "Circular dependency detected: circular -> circular"
      );
    });

    it("should throw with full path on cross-token cycle (A -> B -> A)", () => {
      container.register("a", () => container.get("b"));
      container.register("b", () => container.get("a"));
      expect(() => container.get("a")).toThrow("Circular dependency detected: a -> b -> a");
    });

    it("should clean up resolving state when a factory throws", () => {
      let shouldThrow = true;
      container.register(
        "flaky",
        () => {
          if (shouldThrow) throw new Error("factory error");
          return { value: "ok" };
        },
        false
      );

      expect(() => container.get("flaky")).toThrow("factory error");

      // Subsequent call should not falsely trigger the circular dependency guard
      shouldThrow = false;
      expect(container.get<{ value: string }>("flaky").value).toBe("ok");
    });

    it("should allow non-circular cross-token resolution inside a factory", () => {
      container.register("a", () => ({ dep: container.get<{ value: number }>("b"), name: "a" }));
      container.register("b", () => ({ value: 42 }));
      const a = container.get<{ dep: { value: number }; name: string }>("a");
      expect(a.name).toBe("a");
      expect(a.dep.value).toBe(42);
    });
  });

  describe("createChildContainer", () => {
    it("should inherit factory registrations from parent", () => {
      container.register("svc", () => ({ value: "parent" }));
      const child = container.createChildContainer();
      expect(child.has("svc")).toBe(true);
      expect(child.get<{ value: string }>("svc").value).toBe("parent");
    });

    it("should inherit singleton instances from parent", () => {
      const instance = { value: "shared" };
      container.registerInstance("svc", instance);
      const child = container.createChildContainer();
      expect(child.get("svc")).toBe(instance);
    });

    it("should not affect parent when child registers new service", () => {
      const child = container.createChildContainer();
      child.register("childOnly", () => ({ x: 1 }));
      expect(child.has("childOnly")).toBe(true);
      expect(container.has("childOnly")).toBe(false);
    });

    it("should not dispose parent-owned singleton instances on child disposal", async () => {
      let disposed = 0;
      const instance = {
        dispose() {
          disposed++;
        },
      };
      container.registerInstance("shared", instance);

      const child = container.createChildContainer();
      // Child shares the parent's instance.
      expect(child.get("shared")).toBe(instance);

      await child.dispose();

      // The inherited instance must NOT be disposed by the child...
      expect(disposed).toBe(0);
      // ...and must still be usable from the parent.
      expect(container.get("shared")).toBe(instance);

      // The parent still owns it and disposes it when the parent is disposed.
      await container.dispose();
      expect(disposed).toBe(1);
    });

    it("should dispose a child's own instances even when it inherits from parent", async () => {
      const parentDisposed = { count: 0 };
      container.registerInstance("shared", {
        dispose() {
          parentDisposed.count++;
        },
      });

      const child = container.createChildContainer();
      let childDisposed = 0;
      child.registerInstance("childOwned", {
        dispose() {
          childDisposed++;
        },
      });

      await child.dispose();
      expect(childDisposed).toBe(1);
      expect(parentDisposed.count).toBe(0);
    });
  });
});
