//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { CompoundTask, SingleTask } from "./Task";

const all = new Map<string, typeof SingleTask | typeof CompoundTask>();

const registerTask = (baseClass: typeof SingleTask | typeof CompoundTask) => {
  all.set(baseClass.type, baseClass);
};

export const TaskRegistry = {
  registerTask,
  all,
};
