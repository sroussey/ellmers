/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  FromExtendedSchema,
  FromExtendedSchemaOptions,
  FromSchemaOptions,
} from "@sroussey/json-schema-to-ts";
import type { JsonSchema, JsonSchemaCustomProps } from "./JsonSchema";

export { FromSchemaOptions };

/**
 * Removes the [$JSONSchema] symbol property from a type
 * This is needed because json-schema-to-ts adds this property which cannot be serialized
 */
export type StripJSONSchema<T> = T extends object
  ? {
      [K in keyof T as K extends symbol ? never : K]: T[K];
    }
  : T;

export const FromSchemaDefaultOptions = {
  parseNotKeyword: true,
  parseIfThenElseKeywords: true,
  keepDefaultedPropertiesOptional: true,
  references: false,
  deserialize: false,
} as const satisfies FromSchemaOptions;

export type FromSchema<
  SCHEMA extends JsonSchema<EXTENSION>,
  OPTIONS extends FromExtendedSchemaOptions<EXTENSION> = typeof FromSchemaDefaultOptions,
  EXTENSION extends JsonSchemaCustomProps = JsonSchemaCustomProps,
> = StripJSONSchema<FromExtendedSchema<EXTENSION, SCHEMA, OPTIONS>>;

/**
 * IncludeProps - Returns a new schema with only the specified properties
 *
 * This is a schema transformer that returns a new schema object.
 * Use with FromSchema like: FromSchema<IncludeProps<typeof schema, typeof ["prop1", "prop2"]>>
 *
 * @template Schema - The JSON schema object (with 'as const')
 * @template Keys - Readonly array type of property keys to include (use typeof ["key1", "key2"] as const)
 *
 * @example
 * const schema = {
 *   type: "object",
 *   properties: {
 *     name: { type: "string" },
 *     age: { type: "number" },
 *     email: { type: "string" }
 *   },
 *   required: ["name"],
 *   additionalProperties: false
 * } as const;
 *
 * type Filtered = FromSchema<IncludeProps<typeof schema, typeof ["name", "age"]>>;
 * // => { name: string, age?: number }
 */
export type IncludeProps<
  Schema extends { readonly type: "object"; readonly properties: Record<string, unknown> },
  Keys extends readonly (keyof Schema["properties"])[],
> = Omit<Schema, "properties" | "required"> & {
  readonly properties: {
    readonly [K in Extract<keyof Schema["properties"], Keys[number]>]: Schema["properties"][K];
  };
} & (Schema extends { readonly required: readonly (infer R extends string)[] }
    ? { readonly required: readonly Extract<R, Keys[number]>[] }
    : object);

/**
 * ExcludeProps - Returns a new schema without the specified properties
 *
 * This is a schema transformer that returns a new schema object.
 * Use with FromSchema like: FromSchema<ExcludeProps<typeof schema, typeof ["prop1", "prop2"]>>
 *
 * @template Schema - The JSON schema object (with 'as const')
 * @template Keys - Readonly array type of property keys to exclude (use typeof ["key1", "key2"] as const)
 *
 * @example
 * const schema = {
 *   type: "object",
 *   properties: {
 *     name: { type: "string" },
 *     age: { type: "number" },
 *     email: { type: "string" }
 *   },
 *   required: ["name"],
 *   additionalProperties: false
 * } as const;
 *
 * type Filtered = FromSchema<ExcludeProps<typeof schema, typeof ["email"]>>;
 * // => { name: string, age?: number }
 */
export type ExcludeProps<
  Schema extends { readonly type: "object"; readonly properties: Record<string, unknown> },
  Keys extends readonly (keyof Schema["properties"])[],
> = Omit<Schema, "properties" | "required"> & {
  readonly properties: {
    readonly [K in Exclude<keyof Schema["properties"], Keys[number]>]: Schema["properties"][K];
  };
} & (Schema extends { readonly required: readonly (infer R extends string)[] }
    ? { readonly required: readonly Exclude<R, Keys[number]>[] }
    : object);
