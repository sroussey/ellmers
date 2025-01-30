//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { pipeline, env } from "@huggingface/transformers";
import { registerWorker } from "./provider/HFT_Worker";

env.backends.onnx.logLevel = "error";
env.backends.onnx.debug = true;

registerWorker(pipeline);