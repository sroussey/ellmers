//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { DiscriminatorSchema, KVRepository } from "./KVRepository";
import { makeFingerprint } from "../../util/Misc";

// InMemoryKVRepository is a simple in-memory key-value store that can be used for testing or as a cache
// It does not support discriminators

export class InMemoryKVRepository<
  Key = string,
  Value = string,
  Discriminator extends DiscriminatorSchema = DiscriminatorSchema,
> extends KVRepository<Key, Value, Discriminator> {
  values = new Map<string, Value>();

  async put(key: Key, value: Value): Promise<void> {
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
    this.values.set(id, value);
    this.emit("put", id);
  }

  async get(key: Key): Promise<Value | undefined> {
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
    const out = this.values.get(id);
    this.emit("get", id);
    return out;
  }

  async clear(): Promise<void> {
    this.values.clear();
    this.emit("clear");
  }

  async size(): Promise<number> {
    return this.values.size;
  }
}
