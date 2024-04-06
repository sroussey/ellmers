//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";

export type KVEvents = "put" | "get" | "clear";

export type DiscriminatorSchema = Record<string, "string" | "number" | "boolean">;

export abstract class KVRepository<
  Key,
  Value,
  Discriminators extends DiscriminatorSchema = DiscriminatorSchema,
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

  // discriminators for KV repository store
  protected discriminatorsSchema: Discriminators = {} as Discriminators;

  // Abstract methods for KV repository store
  abstract put(key: Key, value: Value): Promise<void>;
  abstract get(key: Key): Promise<Value | undefined>;
  abstract clear(): Promise<void>;
  abstract size(): Promise<number>;

  // Discriminator helper methods
  protected primaryKeyColumnList(): string {
    return this.primaryKeyColumns().join(", ");
  }

  protected primaryKeyColumns(): string[] {
    return Object.keys(this.discriminatorsSchema).concat("key");
  }

  protected extractDiscriminators(keySimpleOrObject: any): {
    discriminators: Record<string, string | number | boolean>;
    key: any;
  } {
    const discriminatorKeys = Object.keys(this.discriminatorsSchema);
    const discriminators: DiscriminatorSchema = {};
    if (typeof keySimpleOrObject !== "object") {
      return { discriminators, key: keySimpleOrObject };
    }
    let keyClone: any = { ...keySimpleOrObject };
    if (discriminatorKeys.length > 0) {
      discriminatorKeys.forEach((k) => {
        if (keyClone.hasOwnProperty(k)) {
          discriminators[k] = keyClone[k];
          delete keyClone[k];
        }
      });
    }
    if (Object.keys(keyClone).length === 1) {
      keyClone = keyClone[Object.keys(keyClone)[0]];
    }
    return { discriminators, key: keyClone };
  }
}
