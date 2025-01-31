//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Model } from "./Model";
import { ModelRepository, Task2ModelPrimaryKey } from "./ModelRepository";

// temporary model registry that is synchronous until we have a proper model repository

export class FallbackModelRegistry {
  private models: Model[] = [];
  private task2models: Task2ModelPrimaryKey[] = [];

  constructor() {
    console.warn("Using FallbackModelRegistry");
  }

  public async addModel(model: Model): Promise<void> {
    const existingIndex = this.models.findIndex((m) => m.name === model.name);
    if (existingIndex !== -1) {
      this.models[existingIndex] = model;
    } else {
      this.models.push(model);
    }
  }

  public async findModelsByTask(task: string): Promise<Model[]|undefined> {
    const models = this.task2models
      .filter((t2m) => t2m.task === task)
      .map((t2m) => this.models.find((m) => m.name === t2m.model));

    if (models.some((m) => m === undefined)) {
      console.warn(`Some models for task ${task} were not found`);
    }

    const found = models.filter((m): m is Model => m !== undefined)
    return found.length > 0 ? found : undefined;
  }
  public async findTasksByModel(name: string): Promise<string[]> {
    return this.task2models.filter((t2m) => t2m.model === name).map((t2m) => t2m.task);
  }
  public async findByName(name: string): Promise<Model | undefined> {
    return this.models.find((m) => m.name === name);
  }

  public async enumerateAllModels(): Promise<Model[]> {
    return [...this.models];
  }

  public async enumerateAllTasks(): Promise<string[]> {
    return Array.from(new Set(this.task2models.map(t2m => t2m.task)));
  }

  public async size(): Promise<number> {
    return this.models.length;
  }

  public async connectTaskToModel(task: string, modelName: string): Promise<void> {
    if (!this.findByName(modelName)) {
      throw new Error(`Model ${modelName} not found when connecting to task ${task}`);
    }
    
    this.task2models.push({ task, model: modelName });
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
