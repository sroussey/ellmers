//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";

/**
 * Schema definitions for primary keys and values
 */
export type BasicKeyType = string | number | bigint;
export type BasicValueType = string | number | bigint | boolean | null;
export type BasePrimaryKeySchema = Record<string, "string" | "number" | "boolean" | "bigint">;
export type BaseValueSchema = Record<string, "string" | "number" | "boolean" | "bigint">;

/**
 * Default schema types for simple string key-value pairs
 */
export type DefaultPrimaryKeyType = { key: string };
export const DefaultPrimaryKeySchema: BasePrimaryKeySchema = { key: "string" } as const;

export type DefaultValueType = { value: string };
export const DefaultValueSchema: BaseValueSchema = { value: "string" } as const;

/**
 * Type definitions for key-value repository events
 */
export type KVEvents = "put" | "get" | "search" | "delete" | "clearall";

export interface IKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  Combined extends Record<string, any> = Key & Value,
> {
  get(key: BasicKeyType): Promise<BasicValueType | undefined>;
  put(key: BasicKeyType, value: BasicValueType): Promise<void>;
  getKeyValue(key: Key): Promise<Value | undefined>;
  putKeyValue(key: Key, value: Value): Promise<void>;
  deleteKeyValue(key: Key | Combined): Promise<void>;
  getAll(): Promise<Combined[] | undefined>;
  deleteAll(): Promise<void>;
  size(): Promise<number>;
  delete(key: Key): Promise<void>;
  search(key: Partial<Combined>): Promise<Combined[] | undefined>;
  on(
    name: EventEmitter.EventNames<KVEvents>,
    fn: EventEmitter.EventListener<KVEvents, EventEmitter.EventNames<KVEvents>>
  ): void;
  off(
    name: EventEmitter.EventNames<KVEvents>,
    fn: EventEmitter.EventListener<KVEvents, EventEmitter.EventNames<KVEvents>>
  ): void;
}
