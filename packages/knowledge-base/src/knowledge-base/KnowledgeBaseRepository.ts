/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type { EventParameters } from "@workglow/util";
import { EventEmitter } from "@workglow/util";

import type {
  KnowledgeBasePrimaryKeyNames,
  KnowledgeBaseRecord,
  KnowledgeBaseRecordSchema,
} from "./KnowledgeBaseSchema";

export type KnowledgeBaseEventListeners = {
  knowledge_base_added: (record: KnowledgeBaseRecord) => void;
  knowledge_base_removed: (record: KnowledgeBaseRecord) => void;
  knowledge_base_updated: (record: KnowledgeBaseRecord) => void;
};

export type KnowledgeBaseEvents = keyof KnowledgeBaseEventListeners;

export type KnowledgeBaseEventListener<Event extends KnowledgeBaseEvents> =
  KnowledgeBaseEventListeners[Event];

export type KnowledgeBaseEventParameters<Event extends KnowledgeBaseEvents> = EventParameters<
  KnowledgeBaseEventListeners,
  Event
>;

/** Persists KnowledgeBase metadata to tabular storage. */
export class KnowledgeBaseRepository {
  protected readonly storage: ITabularStorage<
    typeof KnowledgeBaseRecordSchema,
    typeof KnowledgeBasePrimaryKeyNames
  >;

  constructor(
    storage: ITabularStorage<typeof KnowledgeBaseRecordSchema, typeof KnowledgeBasePrimaryKeyNames>
  ) {
    this.storage = storage;
  }

  protected events = new EventEmitter<KnowledgeBaseEventListeners>();

  /** Must be called before using any other methods. */
  async setupDatabase(): Promise<void> {
    await this.storage.setupDatabase?.();
  }

  on<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.on(name, fn);
  }

  off<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.off(name, fn);
  }

  once<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.once(name, fn);
  }

  waitOn<Event extends KnowledgeBaseEvents>(name: Event) {
    return this.events.waitOn(name);
  }

  async addKnowledgeBase(record: KnowledgeBaseRecord): Promise<KnowledgeBaseRecord> {
    await this.storage.put(record);
    this.events.emit("knowledge_base_added", record);
    return record;
  }

  async removeKnowledgeBase(kb_id: string): Promise<void> {
    const record = await this.storage.get({ kb_id });
    if (!record) {
      throw new Error(`KnowledgeBase with id "${kb_id}" not found`);
    }
    await this.storage.delete({ kb_id });
    this.events.emit("knowledge_base_removed", record);
  }

  async getKnowledgeBase(kb_id: string): Promise<KnowledgeBaseRecord | undefined> {
    if (typeof kb_id !== "string") return undefined;
    const record = await this.storage.get({ kb_id });
    return record ?? undefined;
  }

  async enumerateAll(): Promise<KnowledgeBaseRecord[]> {
    const records = await this.storage.getAll();
    if (!records || records.length === 0) return [];
    return records;
  }

  async size(): Promise<number> {
    return await this.storage.size();
  }
}
