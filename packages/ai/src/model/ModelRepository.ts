//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { KVRepository } from "ellmers-core";
import {
  Model,
  ModelPrimaryKey,
  ModelProviderEnum,
  ModelUseCaseEnum,
  ModelPrimaryKeySchema,
} from "./Model";

export type ModelEvents = "models_cleared";

export abstract class ModelRepository {
  public type = "TaskOutputRepository";
  abstract kvRepository: KVRepository<unknown, Model, typeof ModelPrimaryKeySchema>;
  private events = new EventEmitter<ModelEvents>();
  on(name: ModelEvents, fn: (...args: any[]) => void) {
    this.events.on.call(this.events, name, fn);
  }
  off(name: ModelEvents, fn: (...args: any[]) => void) {
    this.events.off.call(this.events, name, fn);
  }
  emit(name: ModelEvents, ...args: any[]) {
    this.events.emit.call(this.events, name, ...args);
  }

  findByName(key: unknown) {
    if (typeof key != "string") return undefined;
    return this.kvRepository.getKeyValue(key);
  }

  findByUseCase(usecase: ModelUseCaseEnum) {
    return this.kvRepository.getKeyValue({ useCase: usecase.toLowerCase() });
  }

  async clear(): Promise<void> {
    await this.kvRepository.deleteAll();
    this.emit("models_cleared");
  }

  async size(): Promise<number> {
    return await this.kvRepository.size();
  }
}
