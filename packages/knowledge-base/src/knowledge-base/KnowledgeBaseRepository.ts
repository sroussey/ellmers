/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type { EventParameters } from "@workglow/util";
import { EventEmitter } from "@workglow/util";

import type { KnowledgeBaseRecord } from "./KnowledgeBaseSchema";
import { KnowledgeBasePrimaryKeyNames, KnowledgeBaseRecordSchema } from "./KnowledgeBaseSchema";

/**
 * Events that can be emitted by the KnowledgeBaseRepository
 */

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

/**
 * Repository for persisting KnowledgeBase metadata to tabular storage.
 * Follows the same pattern as ModelRepository.
 */
export class KnowledgeBaseRepository {
  /**
   * Storage for KnowledgeBase records
   */
  protected readonly storage: ITabularStorage<
    typeof KnowledgeBaseRecordSchema,
    typeof KnowledgeBasePrimaryKeyNames
  >;

  constructor(
    storage: ITabularStorage<typeof KnowledgeBaseRecordSchema, typeof KnowledgeBasePrimaryKeyNames>
  ) {
    this.storage = storage;
  }

  /** Event emitter for repository events */
  protected events = new EventEmitter<KnowledgeBaseEventListeners>();

  /**
   * Sets up the database for the repository.
   * Must be called before using any other methods.
   */
  async setupDatabase(): Promise<void> {
    await this.storage.setupDatabase?.();
  }

  /**
   * Registers an event listener for the specified event
   */
  on<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.on(name, fn);
  }

  /**
   * Removes an event listener for the specified event
   */
  off<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.off(name, fn);
  }

  /**
   * Adds an event listener that will only be called once
   */
  once<Event extends KnowledgeBaseEvents>(name: Event, fn: KnowledgeBaseEventListener<Event>) {
    this.events.once(name, fn);
  }

  /**
   * Returns when the event was emitted (promise form of once)
   */
  waitOn<Event extends KnowledgeBaseEvents>(name: Event) {
    return this.events.waitOn(name);
  }

  /**
   * Adds a new knowledge base record to the repository
   */
  async addKnowledgeBase(record: KnowledgeBaseRecord): Promise<KnowledgeBaseRecord> {
    await this.storage.put(record);
    this.events.emit("knowledge_base_added", record);
    return record;
  }

  /**
   * Removes a knowledge base record from the repository
   */
  async removeKnowledgeBase(kb_id: string): Promise<void> {
    const record = await this.storage.get({ kb_id });
    if (!record) {
      throw new Error(`KnowledgeBase with id "${kb_id}" not found`);
    }
    await this.storage.delete({ kb_id });
    this.events.emit("knowledge_base_removed", record);
  }

  /**
   * Retrieves a knowledge base record by ID
   */
  async getKnowledgeBase(kb_id: string): Promise<KnowledgeBaseRecord | undefined> {
    if (typeof kb_id !== "string") return undefined;
    const record = await this.storage.get({ kb_id });
    return record ?? undefined;
  }

  /**
   * Enumerates all knowledge base records
   */
  async enumerateAll(): Promise<KnowledgeBaseRecord[]> {
    const records = await this.storage.getAll();
    if (!records || records.length === 0) return [];
    return records;
  }

  /**
   * Gets the total number of knowledge base records
   */
  async size(): Promise<number> {
    return await this.storage.size();
  }
}
