/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test-only surface for `@workglow/task-graph`.
 *
 * Two kinds of thing land here, and they have different rules:
 *
 * - **Test doubles** (this file's current contents) — subclasses and fakes that
 *   only tests construct. They may be defined inside this bundle, because the
 *   main bundle never references them, so there is no second copy to diverge
 *   from. They must still import their BASE classes by package specifier, or
 *   the base gets inlined here and `instanceof` stops working.
 * - **Reset hooks and shared registries** — anything the main bundle also
 *   touches. Those cannot live here; they go through an `_internal` bag on the
 *   public entry and are re-exported from this file, so both entries resolve to
 *   one instance.
 *
 * Nothing here is public API and none of it is re-exported from `.`.
 */

export { InMemoryTaskOutputRepository } from "./testing/InMemoryTaskOutputRepository";
