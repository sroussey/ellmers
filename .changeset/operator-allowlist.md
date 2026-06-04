---
"@workglow/storage": patch
---

#### storage (security, L-MAIN-01)

- Tighten `isSearchCondition` to also verify the operator is one of
  `=`, `<`, `<=`, `>`, `>=` — the closed allow-list. A forged
  `SearchCondition` smuggled past TypeScript (e.g. parsed from JSON
  at an HTTP boundary) can no longer interpolate arbitrary SQL into
  a WHERE clause via `buildSearchWhere`.
- Add `ALLOWED_SEARCH_OPERATORS` and `SEARCH_OPERATOR_SET` exports as
  the single source of truth for the allow-list.
- `buildSearchWhere` now performs a defense-in-depth check on the
  operator immediately before concatenating it into SQL.
