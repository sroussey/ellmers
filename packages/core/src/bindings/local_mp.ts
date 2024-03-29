import {
  MediaPipeTfJsLocal_Download,
  MediaPipeTfJsLocal_Embedding,
} from "../provider/local-media-pipe/MediaPipeLocalTaskRun";
import { ModelProcessorEnum } from "../model/Model";
import { getProviderRegistry } from "../provider/ProviderRegistry";
import { DownloadModelTask, TextEmbeddingTask } from "task";

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
