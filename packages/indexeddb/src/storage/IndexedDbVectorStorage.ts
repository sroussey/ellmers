/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AnyVectorStorage,
  ClientProvidedKeysOption,
  IVectorStorage,
  VectorSearchOptions,
} from "@workglow/storage";
import { getMetadataProperty, getVectorProperty, matchesFilter } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import type {
  DataPortSchemaObject,
  FromSchema,
  TypedArray,
  TypedArrayConstructor,
  TypedArraySchemaOptions,
} from "@workglow/util/schema";
import { cosineSimilarity } from "@workglow/util/schema";
import type { MigrationOptions } from "./IndexedDbTable";
import { IndexedDbTabularStorage } from "./IndexedDbTabularStorage";

export const IDB_VECTOR_REPOSITORY = createServiceToken<AnyVectorStorage>(
  "storage.vectorRepository.indexedDb"
);

/**
 * IndexedDB vector storage implementation.
 * Extends IndexedDbTabularStorage for storage.
 * Suitable for browser applications that need persistent vector storage.
 * No vector serialization needed since IndexedDB supports TypedArrays
 * natively via structured clone.
 *
 * @template Schema - The schema definition for the entity
 * @template PrimaryKeyNames - The primary key names
 * @template Metadata - The metadata type for the vector
 * @template VectorCtor - Constructor for stored vectors (default {@link typeof Float32Array})
 * @template Entity - The entity type
 */
export class IndexedDbVectorStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>
  extends IndexedDbTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  private vectorDimensions: number;
  private vectorPropertyName: keyof Entity;
  private metadataPropertyName: keyof Entity | undefined;

  constructor(
    table: string = "vectors",
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
    dimensions: number,
    _vectorCtor: TypedArrayConstructor = Float32Array,
    migrationOptions: MigrationOptions = {},
    clientProvidedKeys: ClientProvidedKeysOption = "if-missing"
  ) {
    super(table, schema, primaryKeyNames, indexes, migrationOptions, clientProvidedKeys);

    this.vectorDimensions = dimensions;

    const vectorProp = getVectorProperty(schema);
    if (!vectorProp) {
      throw new Error("Schema must have a property with type array and format TypedArray");
    }
    this.vectorPropertyName = vectorProp as keyof Entity;
    this.metadataPropertyName = getMetadataProperty(schema) as keyof Entity | undefined;
  }

  getVectorDimensions(): number {
    return this.vectorDimensions;
  }

  async similaritySearch(
    query: TypedArray,
    options: VectorSearchOptions<Record<string, unknown>> = {}
  ) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: Array<Entity & { score: number }> = [];

    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      // IndexedDB stores TypedArrays natively via structured clone
      const vector = entity[this.vectorPropertyName] as TypedArray;
      const metadata = this.metadataPropertyName
        ? (entity[this.metadataPropertyName] as Metadata)
        : ({} as Metadata);

      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(query, vector);

      if (score < scoreThreshold) {
        continue;
      }

      results.push({
        ...entity,
        score,
      } as Entity & { score: number });
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }
}
