/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { objectOfArraysAsArrayOfObjects, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

describe("Object of arrays to array of objects proxy", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  it("should return the initial length and numeric index access", () => {
    const data = { id: [1, 2, 3], name: ["Alice", "Bob", "Charlie"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    expect(proxy.length).toBe(3);
    const row0 = proxy[0];
    expect(row0.id).toBe(1);
    expect(row0.name).toBe("Alice");
  });
  it("should update underlying data when a row is updated", () => {
    const data = { id: [1, 2, 3], name: ["Alice", "Bob", "Charlie"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    const row1 = proxy[1];
    row1.name = "Bobby";
    expect(data.name[1]).toBe("Bobby");
  });

  it("should push a new row", () => {
    const data = { id: [1, 2], name: ["Alice", "Bob"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    proxy.push({ id: 3, name: "Charlie" });
    expect(proxy.length).toBe(3);
    expect(proxy[2].name).toBe("Charlie");
  });

  it("should pop the array", () => {
    const data = { id: [1, 2, 3], name: ["Alice", "Bob", "Charlie"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    const popped = proxy.pop();
    expect(popped?.name).toBe("Charlie");
    expect(proxy.length).toBe(2);
  });

  it("should unshift the array", () => {
    const data = { id: [2, 3], name: ["Bob", "Charlie"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    proxy.unshift({ id: 1, name: "Alice" });
    expect(proxy.length).toBe(3);
    expect(proxy[0].name).toBe("Alice");
  });

  it("should shift the array", () => {
    const data = { id: [1, 2, 3], name: ["Alice", "Bob", "Charlie"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    const shifted = proxy.shift();
    expect(shifted?.name).toBe("Alice");
    expect(proxy.length).toBe(2);
  });

  it("should splice the array", () => {
    const data = { id: [1, 2, 3, 4], name: ["Alice", "Bob", "Charlie", "David"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    const removed = proxy.splice(1, 1, { id: 99, name: "Zoe" });
    expect(removed[0].name).toBe("Bob");
    expect(proxy[1].name).toBe("Zoe");
    expect(proxy.length).toBe(4);
  });

  it("should reverse the array", () => {
    const data = { id: [1, 2, 3], name: ["Alice", "Bob", "Charlie"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    proxy.reverse();
    expect(proxy[0].name).toBe("Charlie");
    expect(proxy[2].name).toBe("Alice");
  });

  it("should sort the array", () => {
    const data = { id: [3, 1, 2], name: ["Charlie", "Alice", "Bob"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    proxy.sort((a, b) => a.id - b.id);
    expect(proxy[0].name).toBe("Alice");
    expect(proxy[1].name).toBe("Bob");
    expect(proxy[2].name).toBe("Charlie");
  });

  it("should work with includes, indexOf, lastIndexOf", () => {
    const data = { id: [1, 2, 3, 2], name: ["Alice", "Bob", "Charlie", "Bob"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    expect(proxy.includes({ id: 2, name: "Bob" })).toBe(true);
    expect(proxy.indexOf({ id: 2, name: "Bob" })).toBe(1);
    expect(proxy.lastIndexOf({ id: 2, name: "Bob" })).toBe(3);
    expect(proxy.indexOf({ id: 2, name: "Bob" }, 2)).toBe(3);
    expect(proxy.lastIndexOf({ id: 2, name: "Bob" }, 2)).toBe(1);
  });

  it("should yield live row proxies", () => {
    const data = { id: [1, 2, 3], name: ["Alice", "Bob", "Charlie"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    let count = 0;
    for (const row of proxy) {
      expect(row.id).toBe(data.id[count]);
      row.name = row.name + " Updated";
      count++;
    }
    expect(data.name).toEqual(["Alice Updated", "Bob Updated", "Charlie Updated"]);
  });

  it("slice returns dense rows, not sparse holes", () => {
    // Regression: without a `has` trap, native Array.prototype.slice sees every
    // index as an absent hole and returns a sparse array whose spread becomes
    // [undefined, undefined].
    const data = { a: [1, 2, 3, 4], b: ["w", "x", "y", "z"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    const head = proxy.slice(0, 2);
    expect(head.length).toBe(2);
    expect([...head]).toEqual([
      { a: 1, b: "w" },
      { a: 2, b: "x" },
    ]);
    expect(head.some((r) => r === undefined)).toBe(false);
    expect(head.map((r) => r.a)).toEqual([1, 2]);
    expect(proxy.slice(2).map((r) => r.a)).toEqual([3, 4]);
    expect(proxy.slice(-1).map((r) => r.a)).toEqual([4]);
  });

  it("reports in-range indices as present via the `in` operator", () => {
    const data = { a: [1, 2, 3, 4], b: ["w", "x", "y", "z"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    expect(0 in proxy).toBe(true);
    expect(3 in proxy).toBe(true);
    expect(4 in proxy).toBe(false);
    expect("length" in proxy).toBe(true);
  });

  it("supports native methods that probe presence (at, concat)", () => {
    const data = { a: [1, 2, 3, 4], b: ["w", "x", "y", "z"] };
    const proxy = objectOfArraysAsArrayOfObjects(data);
    expect((proxy.at?.(1) as { b: string } | undefined)?.b).toBe("x");
    const combined = ([] as { a: number; b: string }[]).concat(
      proxy as unknown as { a: number; b: string }[]
    );
    expect(combined.map((r) => r.a)).toEqual([1, 2, 3, 4]);
  });
});
