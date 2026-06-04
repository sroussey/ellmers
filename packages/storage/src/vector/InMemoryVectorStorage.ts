/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchemaObject,
  FromSchema,
  TypedArray,
  TypedArrayConstructor,
  TypedArraySchemaOptions,
} from "@workglow/util/schema";
import { cosineSimilarity } from "@workglow/util/schema";
import { InMemoryTabularStorage } from "../tabular/InMemoryTabularStorage";
import type { IVectorStorage, VectorSearchOptions } from "./IVectorStorage";
import { getMetadataProperty, getVectorProperty } from "./IVectorStorage";

function matchesFilter<Metadata>(metadata: Metadata, filter: Partial<Metadata>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key as keyof Metadata] !== value) {
      return false;
    }
  }
  return true;
}

/** In-memory {@link IVectorStorage} on top of {@link InMemoryTabularStorage}. */
export class InMemoryVectorStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>
  extends InMemoryTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  private vectorDimensions: number;
  private vectorPropertyName: keyof Entity;
  private metadataPropertyName: keyof Entity | undefined;

  constructor(
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
    dimensions: number,
    _vectorCtor: TypedArrayConstructor = Float32Array
  ) {
    super(schema, primaryKeyNames, indexes);

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
    return results.slice(0, topK);
  }
}
