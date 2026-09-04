/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { SearchInCondition, SearchNotInCondition } from "../ITabularStorage";
import { StorageUnfilteredDeleteError } from "../StorageError";
import { shouldRunDeleteSearch } from "../tabularValidation";

interface Row {
  readonly tenant: string;
  readonly status: string;
  readonly value: number;
}

const notIn = (values: string[]): SearchNotInCondition<string> => ({
  value: values,
  operator: "not-in",
});

describe("shouldRunDeleteSearch", () => {
  it("reports nothing to do for empty criteria", () => {
    // The long-standing silent no-op. It must never become `DELETE FROM t`,
    // and it is not an error either — callers pass a built-up criteria bag.
    expect(shouldRunDeleteSearch<Row>({})).toBe(false);
  });

  it("throws when the only criterion excludes nothing", () => {
    expect(() => shouldRunDeleteSearch<Row>({ status: notIn([]) })).toThrow(
      StorageUnfilteredDeleteError
    );
    expect(() => shouldRunDeleteSearch<Row>({ status: notIn([]) })).toThrow(
      /delete the whole table/
    );
  });

  it("throws when every criterion excludes nothing, and names them all", () => {
    let message = "";
    try {
      shouldRunDeleteSearch<Row>({ status: notIn([]), tenant: notIn([]) });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"status"');
    expect(message).toContain('"tenant"');
  });

  it("runs when another column narrows the delete", () => {
    // The refusal is about criteria that name no rows in particular, not about
    // the empty exclusion itself — this one still deletes only acme's rows.
    expect(shouldRunDeleteSearch<Row>({ tenant: "acme", status: notIn([]) })).toBe(true);
  });

  it("runs for a non-empty exclusion", () => {
    expect(shouldRunDeleteSearch<Row>({ status: notIn(["published"]) })).toBe(true);
  });

  it("does not confuse an empty `in` list with an empty exclusion", () => {
    // An empty `in` matches nothing, so it deletes nothing — the opposite
    // hazard, and one the backends already render as an always-false predicate.
    const emptyIn: SearchInCondition<string> = { value: [], operator: "in" };
    expect(shouldRunDeleteSearch<Row>({ status: emptyIn })).toBe(true);
  });

  it("counts a key whose value is `undefined` as narrowing, so the guard stays quiet", () => {
    // A caller spreading an optional filter — `{ ...maybeTenant, excluded }`
    // where `maybeTenant` is `{ tenant: undefined }` — puts `tenant` in
    // `Object.keys` with no value, and that is enough to keep this from
    // reading as a match-all. Deliberate: `undefined` is an ordinary equality
    // criterion everywhere else in the stack (see the note on
    // `matchesEqualityCriterion`), and teaching only this guard to discount it
    // would make it disagree with the delete it is guarding.
    //
    // The delete that follows deletes nothing at all on every backend, since
    // an `undefined` criterion matches no row — so what escapes the guard is
    // the opposite of a full-table delete.
    expect(shouldRunDeleteSearch<Row>({ tenant: undefined, status: notIn([]) })).toBe(true);
    expect(shouldRunDeleteSearch<Row>({ tenant: undefined })).toBe(true);
  });

  it("runs for ordinary criteria", () => {
    expect(shouldRunDeleteSearch<Row>({ tenant: "acme" })).toBe(true);
    expect(shouldRunDeleteSearch<Row>({ value: { value: 5, operator: "<" } })).toBe(true);
    expect(shouldRunDeleteSearch<Row>({ status: null as never })).toBe(true);
  });
});
