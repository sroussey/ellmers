//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Model } from "./Model";
import { ModelRepository, Task2ModelPrimaryKey } from "./ModelRepository";

// temporary model registry that is synchronous until we have a proper model repository

class FallbackModelRegistry {
  models: Model[] = [];
  task2models: Task2ModelPrimaryKey[] = [];

  public async addModel(model: Model) {
    if (this.models.some((m) => m.name === model.name)) {
      this.models = this.models.filter((m) => m.name !== model.name);
    }

    this.models.push(model);
  }
  public async findModelsByTask(task: string) {
    return this.task2models
      .filter((t2m) => t2m.task === task)
      .map((t2m) => this.models.find((m) => m.name === t2m.model))
      .filter((m) => m !== undefined);
  }
  public async findTasksByModel(name: string) {
    return this.task2models.filter((t2m) => t2m.model === name).map((t2m) => t2m.task);
  }
  public async findByName(name: string) {
    return this.models.find((m) => m.name === name);
  }
  public async connectTaskToModel(task: string, model: string) {
    this.task2models.push({ task, model });
  }
}

let modelRegistry: FallbackModelRegistry | ModelRepository;
export function getGlobalModelRepository() {
  if (!modelRegistry) modelRegistry = new FallbackModelRegistry();
  return modelRegistry;
}
export function setGlobalModelRepository(pr: FallbackModelRegistry | ModelRepository) {
  modelRegistry = pr;
}
