---
"@workglow/storage": minor
---

#### storage (security, L-MAIN-03)

- `LazyEncryptedCredentialStore.unlock(passphrase)` is now `async` and
  verifies the passphrase via a sentinel marker before assigning the
  inner `EncryptedKvCredentialStore`. Previously a mistyped passphrase
  silently "unlocked" the store, and subsequent `put()` calls encrypted
  new entries under the wrong key — irreversibly diverging from
  existing entries.
- Behaviour:
  - sentinel present + correct passphrase → unlocks.
  - sentinel present + wrong passphrase → throws
    `Invalid passphrase for credential store.`
  - sentinel absent + empty KV (first-time init) → writes sentinel and
    unlocks.
  - sentinel absent + existing rows (legacy migration) → probes one
    existing row; on successful decrypt writes the sentinel and
    unlocks, on failure throws.
- `EncryptedKvCredentialStore` exposes `writeSentinel()` and
  `verifyPassphrase()` and now hides the reserved
  `__credstore_sentinel__` key from `keys()`, `has()`, and `delete()`;
  `deleteAll()` rewrites the sentinel after the clear so future unlocks
  keep verifying.

**Breaking** (storage minor): `LazyEncryptedCredentialStore.unlock`
returns `Promise<void>` rather than `void`. In-tree consumers in the
`@workglow/libs` repo have been updated.
