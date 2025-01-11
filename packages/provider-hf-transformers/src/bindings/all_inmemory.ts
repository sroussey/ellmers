import { getProviderRegistry } from "ellmers-core";
import { registerHuggingfaceLocalTasks } from "./local_hf";
import { InMemoryJobQueue } from "ellmers-core";
import { ModelProcessorEnum } from "ellmers-core";
import { ConcurrencyLimiter } from "ellmers-core";
import { TaskInput, TaskOutput } from "ellmers-core";

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
