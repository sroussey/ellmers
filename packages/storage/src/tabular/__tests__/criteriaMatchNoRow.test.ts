/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { SearchCondition, SearchInCondition, SearchNotInCondition } from "../ITabularStorage";
import { criteriaMatchNoRow } from "../tabularValidation";

interface Row {
  readonly tenant: string;
  readonly status: string;
  readonly value: number;
}

const inList = (values: (string | null | undefined)[]): SearchInCondition<string> =>
  ({ value: values, operator: "in" }) as SearchInCondition<string>;
const notInList = (values: (string | null | undefined)[]): SearchNotInCondition<string> =>
  ({ value: values, operator: "not-in" }) as SearchNotInCondition<string>;

/**
 * The question `HttpTabularProxyStorage` and `SupabaseTabularStorage` ask
 * before handing criteria to a peer that could not answer it faithfully — JSON
 * drops an `undefined`-valued key, and a PostgREST filter is URL text. A wrong
 * `false` here sends a request whose meaning changed in transit; a wrong `true`
 * silently returns nothing. Both fail quietly, so both are pinned.
 */
describe("criteriaMatchNoRow", () => {
  it("is false for no criteria at all", () => {
    expect(criteriaMatchNoRow<Row>(undefined)).toBe(false);
    expect(criteriaMatchNoRow<Row>({})).toBe(false);
  });

  it("is false for ordinary criteria", () => {
    expect(criteriaMatchNoRow<Row>({ tenant: "acme" })).toBe(false);
    expect(criteriaMatchNoRow<Row>({ value: { value: 5, operator: "<" } })).toBe(false);
    expect(criteriaMatchNoRow<Row>({ tenant: "acme", status: "open" })).toBe(false);
  });

  it("is TRUE for an `undefined` compare value, whatever the operator", () => {
    // It binds as NULL, and every comparison against NULL is UNKNOWN.
    expect(criteriaMatchNoRow<Row>({ tenant: undefined })).toBe(true);
    expect(
      criteriaMatchNoRow<Row>({
        value: { value: undefined, operator: "<" } as unknown as SearchCondition<number>,
      })
    ).toBe(true);
    // One such column is enough, however many others would have narrowed.
    expect(criteriaMatchNoRow<Row>({ tenant: "acme", status: undefined })).toBe(true);
  });

  it("is FALSE for a `null` compare value, which means IS NULL and does match", () => {
    // The distinction the whole helper turns on: `null` names the rows holding
    // NULL, `undefined` names nothing.
    expect(criteriaMatchNoRow<Row>({ tenant: null as never })).toBe(false);
    expect(criteriaMatchNoRow<Row>({ tenant: { value: null, operator: "=" } as never })).toBe(
      false
    );
  });

  it("is TRUE for an `in` list with no value that could match", () => {
    // `[].every` is vacuously true, so the empty list is covered by the same
    // test as the all-null one — both name nothing.
    expect(criteriaMatchNoRow<Row>({ status: inList([]) })).toBe(true);
    expect(criteriaMatchNoRow<Row>({ status: inList([null]) })).toBe(true);
    expect(criteriaMatchNoRow<Row>({ status: inList([null, undefined]) })).toBe(true);
  });

  it("is FALSE for an `in` list holding anything real, nulls alongside or not", () => {
    expect(criteriaMatchNoRow<Row>({ status: inList(["open"]) })).toBe(false);
    expect(criteriaMatchNoRow<Row>({ status: inList(["open", null]) })).toBe(false);
  });

  it("is TRUE for a `not-in` list holding a null, which makes it UNKNOWN for every row", () => {
    expect(criteriaMatchNoRow<Row>({ status: notInList(["open", null]) })).toBe(true);
    expect(criteriaMatchNoRow<Row>({ status: notInList([undefined]) })).toBe(true);
  });

  it("is FALSE for an EMPTY `not-in` list, which matches every row", () => {
    // The trap in this helper: the empty list inverts between the two
    // operators. Reading it as "no rows" here would turn "exclude nothing"
    // into "return nothing" — the opposite of what it means.
    expect(criteriaMatchNoRow<Row>({ status: notInList([]) })).toBe(false);
    expect(criteriaMatchNoRow<Row>({ status: notInList(["open"]) })).toBe(false);
  });
});
