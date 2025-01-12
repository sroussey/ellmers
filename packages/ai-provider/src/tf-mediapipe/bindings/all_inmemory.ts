import { getProviderRegistry } from "ellmers-ai";
import { InMemoryJobQueue } from "ellmers-core";
import { ModelProcessorEnum } from "ellmers-ai";
import { ConcurrencyLimiter } from "ellmers-core";
import { TaskInput, TaskOutput } from "ellmers-core";
import { registerMediaPipeTfJsLocalTasks } from "./local_mp";
import "../model/MediaPipeModelSamples";

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
