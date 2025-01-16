//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  BaseValueSchema,
  BasePrimaryKeySchema,
  BasicValueType,
  BasicKeyType,
  DefaultValueType,
  DefaultValueSchema,
  DefaultPrimaryKeyType,
  DefaultPrimaryKeySchema,
  KVRepository,
} from "ellmers-core";
import { makeFingerprint } from "../../../util/Misc";

// InMemoryKVRepository is a simple in-memory key-value store that can be used for testing or as a cache

export class InMemoryKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Key & Value = Key & Value
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  values = new Map<string, Value>();

  constructor(
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema
  ) {
    super(primaryKeySchema, valueSchema);
  }

  async putKeyValue(key: Key, value: Value): Promise<void> {
    const id = await makeFingerprint(key);
    this.values.set(id, value);
    this.emit("put", id);
  }

  async getKeyValue(key: Key): Promise<Value | undefined> {
    const id = await makeFingerprint(key);
    const out = this.values.get(id);
    this.emit("get", id, out);
    return out;
  }

  async deleteKeyValue(key: Key): Promise<void> {
    const id = await makeFingerprint(key);
    this.values.delete(id);
    this.emit("delete", id);
  }

  async deleteAll(): Promise<void> {
    this.values.clear();
    this.emit("clearall");
  }

  async size(): Promise<number> {
    return this.values.size;
  }
}
