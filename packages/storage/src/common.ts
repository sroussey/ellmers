/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export * from "./tabular/BaseTabularStorage";
export * from "./tabular/BaseSqlTabularStorage";
export * from "./tabular/CachedTabularStorage";
export * from "./tabular/CoveringIndexMissingError";
export { pickCoveringIndex } from "./tabular/coveringIndexPicker";
export type {
  RegisteredIndex,
  PickCoveringIndexInput,
  PickedIndex,
} from "./tabular/coveringIndexPicker";
// Cursor codec: the public surface is the opaque type, the codec
// functions, the length cap, and the cross-arity assertion. The
// payload shape and version constant are implementation details —
// keep them out of `@workglow/storage`'s public API so callers can't
// depend on the encoding format and we stay free to evolve it.
export {
  encodeCursor,
  decodeCursor,
  assertCursorMatches,
  MAX_CURSOR_LENGTH,
} from "./tabular/Cursor";
export type { PageCursor } from "./tabular/Cursor";
export * from "./tabular/HuggingFaceTabularStorage";
export * from "./tabular/InMemoryTabularMigrationApplier";
export * from "./tabular/InMemoryTabularStorage";
export * from "./tabular/ITabularStorage";
export * from "./tabular/StorageError";
export * from "./tabular/TabularStorageRegistry";
export * from "./tabular/sqlMigrationDdl";
export * from "./tabular/SqlTabularMigrationApplier";
export * from "./tabular/TelemetryTabularStorage";

export * from "./kv/IKvStorage";
export * from "./kv/InMemoryKvStorage";
export * from "./kv/KvStorage";
export * from "./kv/KvViaTabularStorage";
export * from "./kv/TelemetryKvStorage";

export * from "./util/HybridSubscriptionManager";
export * from "./util/PollingSubscriptionManager";

export * from "./sql";
export * from "./migrations";

export * from "./vector/InMemoryVectorStorage";
export * from "./vector/IVectorStorage";
export * from "./vector/TelemetryVectorStorage";

export * from "./credentials/EncryptedKvCredentialStore";
export * from "./credentials/LazyEncryptedCredentialStore";
