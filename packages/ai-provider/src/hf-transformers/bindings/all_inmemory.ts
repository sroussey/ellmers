import { InMemoryJobQueue, ConcurrencyLimiter, TaskInput, TaskOutput } from "ellmers-core";
import { getProviderRegistry, ModelProcessorEnum } from "ellmers-ai";

import { registerHuggingfaceLocalTasks } from "./local_hf";
import "../model/ONNXModelSamples";

export async function registerHuggingfaceLocalTasksInMemory() {
  registerHuggingfaceLocalTasks();
  const ProviderRegistry = getProviderRegistry();
  const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
    "local_hf",
    new ConcurrencyLimiter(1, 10),
    10
  );
  ProviderRegistry.registerQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS, jobQueue);
  jobQueue.start();
}
