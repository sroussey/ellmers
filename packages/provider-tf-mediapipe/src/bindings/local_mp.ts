import { ModelProcessorEnum } from "ellmers-core";
import { getProviderRegistry } from "ellmers-core";
import { DownloadModelTask, TextEmbeddingTask } from "ellmers-core";
import {
  MediaPipeTfJsLocal_Download,
  MediaPipeTfJsLocal_Embedding,
} from "../provider/MediaPipeLocalTaskRun";

export const registerMediaPipeTfJsLocalTasks = () => {
  const ProviderRegistry = getProviderRegistry();

  ProviderRegistry.registerRunFn(
    DownloadModelTask.type,
    ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL,
    MediaPipeTfJsLocal_Download
  );

  ProviderRegistry.registerRunFn(
    TextEmbeddingTask.type,
    ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL,
    MediaPipeTfJsLocal_Embedding
  );
};
