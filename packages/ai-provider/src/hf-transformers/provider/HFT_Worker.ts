//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { pipeline } from "@huggingface/transformers";
import type { PipelineType } from "@huggingface/transformers";
 

type PIPELINE = typeof pipeline;
type ArgList = { id: unknown; pipeline: PipelineType; model: string; params: any[]; options: any };

export function registerWorker(pipeline: PIPELINE) {


  const pipelines = new Map<string, any>();
  const getPipeline = async (
    pipelineName: PipelineType,
    modelName: string,
    callback: (beams: any[]) => void,
    options: any
  ) => {
    const name = `${modelName}-${pipelineName}`;
    if (!pipelines.has(name)) {
      pipelines.set(
        name,
        await pipeline(pipelineName, modelName, {
          ...options,
          progress_callback: callback,
        })
      );
    }
    return pipelines.get(name);
  };



  // Listen for messages from the main thread
  self.onmessage = (e: any) => {
    console.log("Worker received message2", e.data);
  };
  self.addEventListener("message", async (e: MessageEvent<ArgList>) => {
    console.log("Worker received message", e.data);
    const { id, pipeline, model, params, options } = e.data;
    const progress_callback = ({ ...status }: any) => postMessage({ ...status, id });
    const instance = await getPipeline(pipeline, model, progress_callback, options);
    if (params.length > 0) {
      const config = params[params.length - 1];
      config.callback_function = (...output: any[]) => {
        postMessage({ status: "update", id, output });
      };
      const output = await instance(...params);
      postMessage({ status: "complete", id, output });
    } else {
      postMessage({ status: "complete", id, output: null });
    }
  });
  console.log("\n\n\n\n\n\n\nWorker loaded\n\n\n\n\n\n\n");
}