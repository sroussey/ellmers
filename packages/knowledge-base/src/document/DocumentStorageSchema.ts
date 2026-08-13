/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type {
  DataPortSchemaObject,
  FromSchema,
  TypedArraySchemaOptions,
} from "@workglow/util/schema";

export const DocumentStorageSchema = {
  type: "object",
  properties: {
    doc_id: {
      type: "string",
      "x-auto-generated": true,
      title: "Document ID",
      description: "Unique identifier for the document",
    },
    data: {
      type: "string",
      title: "Document Data",
      description: "JSON-serialized document",
    },
    metadata: {
      type: "object",
      title: "Metadata",
      description: "Metadata of the document",
    },
  },
  required: ["doc_id", "data"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;
export type DocumentStorageSchema = typeof DocumentStorageSchema;

export const DocumentStorageKey = ["doc_id"] as const;
export type DocumentStorageKey = typeof DocumentStorageKey;

export type DocumentStorageEntity = FromSchema<DocumentStorageSchema, TypedArraySchemaOptions>;

export type InsertDocumentStorageEntity = Omit<DocumentStorageEntity, "doc_id"> &
  Partial<Pick<DocumentStorageEntity, "doc_id">>;

export type DocumentTabularStorage = ITabularStorage<
  typeof DocumentStorageSchema,
  DocumentStorageKey,
  DocumentStorageEntity
>;
