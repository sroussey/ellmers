//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { makeFingerprint } from "../../util/Misc";

export type KVEvents = "put" | "get" | "delete" | "clearall";
export type BasicKeyType = string | number | bigint;
export type BasicValueType = string | number | bigint | boolean | null;

export type BasePrimaryKeySchema = Record<string, "string" | "number" | "boolean" | "bigint">;
export type BaseValueSchema = Record<string, "string" | "number" | "boolean" | "bigint">;

export type DefaultPrimaryKeyType = { "kv-key": string };
export const DefaultPrimaryKeySchema: BasePrimaryKeySchema = { "kv-key": "string" } as const;

export type DefaultValueType = { "kv-value": string };
export const DefaultValueSchema: BaseValueSchema = { "kv-value": "string" } as const;

export abstract class KVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Key & Value = Key & Value
> {
  // KV repository event emitter
  private events = new EventEmitter<KVEvents>();
  on(
    name: EventEmitter.EventNames<KVEvents>,
    fn: EventEmitter.EventListener<KVEvents, EventEmitter.EventNames<KVEvents>>
  ) {
    this.events.on.call(this.events, name, fn);
  }
  off(
    name: EventEmitter.EventNames<KVEvents>,
    fn: EventEmitter.EventListener<KVEvents, EventEmitter.EventNames<KVEvents>>
  ) {
    this.events.off.call(this.events, name, fn);
  }
  emit(
    name: EventEmitter.EventNames<KVEvents>,
    ...args: Parameters<EventEmitter.EventListener<KVEvents, EventEmitter.EventNames<KVEvents>>>
  ) {
    this.events.emit.call(this.events, name, ...args);
  }

  protected primaryKeyIndex: string | undefined = undefined;
  protected valueIndex: string | undefined = undefined;
  constructor(
    protected primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    protected valueSchema: ValueSchema = DefaultValueSchema as ValueSchema
  ) {
    this.primaryKeySchema = primaryKeySchema;
    this.valueSchema = valueSchema;
    if (Object.keys(primaryKeySchema).length === 1) {
      this.primaryKeyIndex = String(this.primaryKeyColumns()[0]);
    }
    if (Object.keys(valueSchema).length === 1) {
      this.valueIndex = String(this.valueColumns()[0]);
    }
  }

  // Abstract methods for KV repository store
  abstract putKeyValue(key: Key, value: Value): Promise<void>;
  abstract getKeyValue(key: Key): Promise<Value | undefined>;
  abstract deleteKeyValue(key: Key | Combined): Promise<void>;
  abstract deleteAll(): Promise<void>;
  abstract size(): Promise<number>;

  public put(key: BasicKeyType | Key, value: Value | BasicValueType): Promise<void> {
    if (typeof key !== "object" && this.primaryKeyIndex) {
      key = { [this.primaryKeyIndex]: key } as Key;
      if (typeof value !== "object" && this.valueIndex) {
        value = { [this.valueIndex]: value } as Value;
      }
    }
    return this.putKeyValue(key as Key, value as Value);
  }

  public async get(key: BasicKeyType | Key): Promise<Value | BasicValueType | undefined> {
    if (typeof key !== "object" && this.primaryKeyIndex) {
      key = { [this.primaryKeyIndex]: key } as Key;
    }
    const value = await this.getKeyValue(key as Key);
    if (typeof value !== "object") return value;
    if (this.primaryKeyIndex && this.valueIndex) {
      return value[this.valueIndex] as BasicValueType;
    }
    return value as Value;
  }

  public async getCombined(key: Key): Promise<Combined | undefined> {
    const value = await this.getKeyValue(key);
    if (typeof value !== "object") return undefined;
    return Object.assign({}, key, value) as Combined;
  }

  public delete(key: Key | BasicKeyType): Promise<void> {
    if (typeof key !== "object" && this.primaryKeyIndex) {
      key = { [this.primaryKeyIndex]: key } as Key;
    }
    return this.deleteKeyValue(key as Key);
  }

  protected primaryKeyColumns(): Array<keyof Key> {
    return Object.keys(this.primaryKeySchema);
  }

  protected valueColumns(): Array<keyof Value> {
    return Object.keys(this.valueSchema);
  }

  protected separateKeyValueFromCombined(obj: Combined): { value: Value; key: Key } {
    if (obj === null) {
      console.warn("Key is null");
      return { value: {} as Value, key: {} as Key };
    }
    if (typeof obj !== "object") {
      console.warn("Object is not an object");
      return { value: {} as Value, key: {} as Key };
    }
    const primaryKeyNames = this.primaryKeyColumns();
    const valueNames = this.valueColumns();
    const value: Partial<Value> = {};
    const key: Partial<Key> = {};
    for (const k of primaryKeyNames) {
      key[k] = obj[k];
    }
    for (const k of valueNames) {
      value[k] = obj[k];
    }

    return { value: value as Value, key: key as Key };
  }

  protected async getKeyAsIdString(key: Key | BasicKeyType): Promise<string> {
    if (this.primaryKeyIndex && typeof key === "object") {
      key = key[this.primaryKeyIndex];
    }
    return await makeFingerprint(key);
  }
}
