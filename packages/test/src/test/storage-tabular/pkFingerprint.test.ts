/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { pkFingerprint } from "@workglow/storage";
import { describe, expect, it } from "vitest";

describe("pkFingerprint", () => {
  it("returns byte-identical output for pre-BigInt primary-key shapes", () => {
    // Anything the previous JSON.stringify pipeline could encode losslessly
    // must produce the same fingerprint after the switch.
    expect(pkFingerprint([1, "hello", true])).toEqual(JSON.stringify([1, "hello", true]));
    expect(pkFingerprint(["only"])).toEqual(JSON.stringify(["only"]));
    expect(pkFingerprint([null])).toEqual(JSON.stringify([null]));
    expect(pkFingerprint([])).toEqual(JSON.stringify([]));
    expect(pkFingerprint([{ a: 1 }])).toEqual(JSON.stringify([{ a: 1 }]));
  });

  it("distinguishes a BigInt PK from a numerically identical string or number", () => {
    // Would-be BigInt encoding for 123n must not collide with the string "123",
    // the number 123, or the marker string "n:123" that a naive encoding could
    // choose. All four must be distinct fingerprints so dedup / response
    // alignment doesn't collapse rows with different PK types.
    const asBig = pkFingerprint([123n]);
    const asStr = pkFingerprint(["123"]);
    const asNum = pkFingerprint([123]);
    const asMarker = pkFingerprint(["n:123"]);
    expect(new Set([asBig, asStr, asNum, asMarker]).size).toEqual(4);
  });

  it("returns equal fingerprints for structurally identical BigInt inputs", () => {
    expect(pkFingerprint([9007199254740993n, "row"])).toEqual(
      pkFingerprint([9007199254740993n, "row"])
    );
  });

  it("distinguishes a Uint8Array PK from a look-alike string or array", () => {
    const bytes = pkFingerprint([new Uint8Array([1, 2, 3])]);
    const str = pkFingerprint(["010203"]);
    const arr = pkFingerprint([[1, 2, 3]]);
    expect(new Set([bytes, str, arr]).size).toEqual(3);
    expect(pkFingerprint([new Uint8Array([1, 2, 3])])).toEqual(
      pkFingerprint([new Uint8Array([1, 2, 3])])
    );
    expect(pkFingerprint([new Uint8Array([1, 2, 3])])).not.toEqual(
      pkFingerprint([new Uint8Array([1, 2, 4])])
    );
  });

  it("returns a stable string for the empty tuple", () => {
    expect(pkFingerprint([])).toEqual("[]");
  });
});
