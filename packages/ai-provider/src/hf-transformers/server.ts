//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { WorkerPipelineProvider } from "./provider/HFT_WorkerPipeline";
import { setPipelineProvider } from "./provider/HFT_PipelineProvider";

export * from "./model/ONNXTransformerJsModel";
export * from "./bindings/registerTasks";

setPipelineProvider(new WorkerPipelineProvider())
