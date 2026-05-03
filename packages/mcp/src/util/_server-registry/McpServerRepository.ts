/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { EventEmitter } from "@workglow/util";
import type { EventParameters } from "@workglow/util";

import { McpServerPrimaryKeyNames, McpServerRecordSchema } from "./McpServerSchema";
import type { McpServerRecord } from "./McpServerSchema";

export type McpServerEventListeners = {
  server_added: (record: McpServerRecord) => void;
  server_removed: (record: McpServerRecord) => void;
  server_updated: (record: McpServerRecord) => void;
};

export type McpServerEvents = keyof McpServerEventListeners;

export type McpServerEventListener<Event extends McpServerEvents> = McpServerEventListeners[Event];

export type McpServerEventParameters<Event extends McpServerEvents> = EventParameters<
  McpServerEventListeners,
  Event
>;

export class McpServerRepository {
  protected readonly storage: ITabularStorage<
    typeof McpServerRecordSchema,
    typeof McpServerPrimaryKeyNames
  >;

  constructor(
    storage: ITabularStorage<typeof McpServerRecordSchema, typeof McpServerPrimaryKeyNames>
  ) {
    this.storage = storage;
  }

  protected events = new EventEmitter<McpServerEventListeners>();

  async setupDatabase(): Promise<void> {
    await this.storage.setupDatabase?.();
  }

  on<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.on(name, fn);
  }

  off<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.off(name, fn);
  }

  once<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.once(name, fn);
  }

  waitOn<Event extends McpServerEvents>(name: Event) {
    return this.events.waitOn(name);
  }

  async addServer(record: McpServerRecord): Promise<McpServerRecord> {
    const existing = await this.storage.get({ server_id: record.server_id });
    await this.storage.put(record);
    this.events.emit(existing ? "server_updated" : "server_added", record);
    return record;
  }

  async removeServer(server_id: string): Promise<void> {
    const record = await this.storage.get({ server_id });
    if (!record) {
      throw new Error(`MCP server with id "${server_id}" not found`);
    }
    await this.storage.delete({ server_id });
    this.events.emit("server_removed", record);
  }

  async getServer(server_id: string): Promise<McpServerRecord | undefined> {
    if (typeof server_id !== "string") return undefined;
    const record = await this.storage.get({ server_id });
    return record ?? undefined;
  }

  async enumerateAll(): Promise<McpServerRecord[]> {
    const records = await this.storage.getAll();
    if (!records || records.length === 0) return [];
    return records;
  }

  async size(): Promise<number> {
    return await this.storage.size();
  }
}
