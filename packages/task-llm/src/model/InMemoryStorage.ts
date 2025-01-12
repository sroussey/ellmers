//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Model, ModelUseCaseEnum } from "./Model";

export function findModelByName(name: string) {
  if (typeof name != "string") return undefined;
  return Model.all.find((m) => m.name.toLowerCase() == name.toLowerCase());
}

export function findModelByUseCase(usecase: ModelUseCaseEnum) {
  return Model.all.filter((m) => m.useCase.includes(usecase));
}

export function findAllModels() {
  return Model.all.slice();
}
