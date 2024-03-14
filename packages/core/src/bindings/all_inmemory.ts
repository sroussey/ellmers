import { getProviderRegistry } from "../provider/ProviderRegistry";
import { registerHuggingfaceLocalTasks } from "./local_hf";
import { registerMediaPipeTfJsLocalTasks } from "./local_mp";
import { InMemoryJobQueue } from "../job/InMemoryJobQueue";
import { ModelProcessorEnum } from "../model/Model";
import { ConcurrencyLimiter } from "../job/ConcurrencyLimiter";
import { TaskInput, TaskOutput } from "../task/base/Task";

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

export async function registerMediaPipeTfJsLocalInMemory() {
  registerMediaPipeTfJsLocalTasks();
  const ProviderRegistry = getProviderRegistry();
  const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
    "local_media_pipe",
    new ConcurrencyLimiter(1, 10),
    10
  );
  ProviderRegistry.registerQueue(ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL, jobQueue);
  jobQueue.start();
}
