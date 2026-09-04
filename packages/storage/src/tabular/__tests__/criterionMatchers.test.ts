/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  matchesEqualityCriterion,
  matchesInCriterion,
  matchesInequalityCriterion,
  matchesNotInCriterion,
} from "../ITabularStorage";

/**
 * The per-row matchers the non-SQL backends filter with. They live or die on
 * one question — whether they answer a criterion the way the SQL backends do,
 * which bind the same criterion straight to `IN` / `= ANY` / a comparison — so
 * every case here is stated against what SQL returns rather than what
 * JavaScript's operators would.
 *
 * Imported by relative path, like the module under test's own callers: these
 * are `@workglow/storage`'s functions, and reaching them through the package
 * barrel would exercise the built bundle instead of this source.
 */
describe("criterion matchers", () => {
  describe("null handling, the rule they do not share", () => {
    it("`=` matches a null column against a null criterion, because SQL rewrites it", () => {
      // `col = NULL` is never true, so the predicate builder emits `IS NULL`
      // instead — and this matcher mirrors that rewrite. An absent column
      // reads back `undefined` and is the same state.
      expect(matchesEqualityCriterion(null, null)).toBe(true);
      expect(matchesEqualityCriterion(undefined, null)).toBe(true);
      expect(matchesEqualityCriterion("x", null)).toBe(false);
    });

    it("`!=` reads as IS NOT NULL against a null criterion, and drops null columns", () => {
      expect(matchesInequalityCriterion("x", null)).toBe(true);
      expect(matchesInequalityCriterion(null, null)).toBe(false);
      // `col != 'x'` is UNKNOWN when col is NULL, so SQL excludes the row —
      // a JS-native `!==` would have included it.
      expect(matchesInequalityCriterion(null, "x")).toBe(false);
    });

    it("`!=` between two non-null values is the ordinary inequality", () => {
      // The branch the null rules above exist to carve out of: once neither
      // side is null there is no three-valued logic left and SQL, JS and this
      // matcher all agree.
      expect(matchesInequalityCriterion("x", "y")).toBe(true);
      expect(matchesInequalityCriterion("x", "x")).toBe(false);
      expect(matchesEqualityCriterion("x", "x")).toBe(true);
      expect(matchesEqualityCriterion("x", "y")).toBe(false);
    });

    it("a list criterion gets no such rewrite, so null columns fall out of both", () => {
      // There is no `IN`-flavoured spelling of IS NULL: `NULL IN (…)` and
      // `NULL NOT IN (…)` are both UNKNOWN. This is why `{ operator: "=",
      // value: null }` stays the only way to ask for null rows.
      for (const columnValue of [null, undefined]) {
        expect(matchesInCriterion(columnValue, [1, 2])).toBe(false);
        expect(matchesNotInCriterion(columnValue, [1, 2])).toBe(false);
      }
    });
  });

  describe("an `undefined` criterion value, which is not the same as null", () => {
    // Reaches these matchers whenever a caller spreads an optional filter:
    // `{ ...maybe }` where `maybe` is `{ col: undefined }` leaves the key in
    // `Object.keys` with no value. The predicate builder does not fold that
    // into its `= NULL` → `IS NULL` rewrite — a key present with no value
    // cannot be told apart from a filter the caller meant to omit — so the SQL
    // backends bind it as NULL and match nothing. These matchers now say the
    // same, which they did not before: read as a plain `===`, an `undefined`
    // criterion matched rows whose column was absent.

    it("matches nothing, whatever the column holds", () => {
      for (const columnValue of [undefined, null, "x", 0, false]) {
        expect(matchesEqualityCriterion(columnValue, undefined)).toBe(false);
        expect(matchesInequalityCriterion(columnValue, undefined)).toBe(false);
      }
    });

    it("is not interchangeable with a null criterion, which does match", () => {
      // The whole reason `undefined` needs its own rule: `null` means IS NULL
      // and matches the null and absent rows, `undefined` means nothing at all.
      expect(matchesEqualityCriterion(null, null)).toBe(true);
      expect(matchesEqualityCriterion(undefined, null)).toBe(true);
      expect(matchesEqualityCriterion(null, undefined)).toBe(false);
      expect(matchesEqualityCriterion(undefined, undefined)).toBe(false);
    });

    it("leaves `!=` empty too, rather than inverting to match everything", () => {
      // `col != NULL` is UNKNOWN, so an exclusion built from a spread optional
      // excludes nothing AND matches nothing — it does not become a no-op.
      expect(matchesInequalityCriterion("x", undefined)).toBe(false);
      expect(matchesInequalityCriterion("x", null)).toBe(true);
    });
  });

  describe("matchesInCriterion", () => {
    it("is strict about type, like the `=` arm", () => {
      expect(matchesInCriterion(1, [1, 2])).toBe(true);
      expect(matchesInCriterion("1", [1])).toBe(false);
    });

    it("leaves a null column unmatched even by a list containing null", () => {
      // `x IN (NULL)` is UNKNOWN too, so listing null rescues nothing. This
      // matcher used to answer it with a JS-native `null === null` and return
      // rows every SQL backend drops.
      for (const columnValue of [null, undefined]) {
        expect(matchesInCriterion(columnValue, [null])).toBe(false);
        expect(matchesInCriterion(columnValue, [undefined])).toBe(false);
        expect(matchesInCriterion(columnValue, [1, null])).toBe(false);
      }
    });

    it("matches nothing for an empty list", () => {
      expect(matchesInCriterion(1, [])).toBe(false);
      expect(matchesInCriterion(null, [])).toBe(false);
    });
  });

  describe("matchesNotInCriterion", () => {
    it("complements `in` wherever SQL has a definite answer", () => {
      for (const columnValue of [1, 2, 3, "1"]) {
        expect(matchesNotInCriterion(columnValue, [1, 2])).toBe(
          !matchesInCriterion(columnValue, [1, 2])
        );
      }
    });

    it("matches nothing when the list itself contains null", () => {
      // `col NOT IN (1, NULL)` is UNKNOWN for every row SQL has not already
      // excluded, so no row can satisfy it.
      expect(matchesNotInCriterion(3, [1, null])).toBe(false);
      expect(matchesNotInCriterion(1, [1, null])).toBe(false);
      expect(matchesNotInCriterion(null, [1, null])).toBe(false);
      expect(matchesNotInCriterion(3, [1, undefined])).toBe(false);
    });

    it("lets a null late in the list outrank a match found earlier", () => {
      // The single-pass loop cannot stop at the first match: order must not
      // change the answer, since SQL's is order-independent.
      expect(matchesNotInCriterion(1, [1, null])).toBe(matchesNotInCriterion(1, [null, 1]));
      expect(matchesNotInCriterion(1, [1, null])).toBe(false);
    });

    it("matches everything for an empty list, the inverse of `in`", () => {
      expect(matchesNotInCriterion(1, [])).toBe(true);
      // Even a null column, since there is no comparison left to be UNKNOWN.
      expect(matchesNotInCriterion(null, [])).toBe(true);
    });

    it("is strict about type, like the `=` arm", () => {
      expect(matchesNotInCriterion("1", [1])).toBe(true);
    });
  });
});
