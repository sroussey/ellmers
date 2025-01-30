//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InlinePipelineProvider } from "./provider/HFT_InlinePipeline";
import { setPipelineProvider } from "./provider/HFT_PipelineProvider";

export * from "./model/ONNXTransformerJsModel";
export * from "./bindings/registerTasks";

setPipelineProvider(new InlinePipelineProvider())