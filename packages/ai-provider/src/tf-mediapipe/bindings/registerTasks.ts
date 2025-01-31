import { getAiProviderRegistry } from "ellmers-ai";
import { DownloadModelTask, TextEmbeddingTask } from "ellmers-ai";
import {
  MediaPipeTfJsLocal_Download,
  MediaPipeTfJsLocal_Embedding,
} from "../provider/MediaPipeLocalTaskRun";
import { MEDIA_PIPE_TFJS_MODEL } from "..";

export const registerMediaPipeTfJsLocalTasks = () => {
  const ProviderRegistry = getAiProviderRegistry();

  ProviderRegistry.registerRunFn(
    DownloadModelTask.type,
    MEDIA_PIPE_TFJS_MODEL,
    MediaPipeTfJsLocal_Download
  );

  ProviderRegistry.registerRunFn(
    TextEmbeddingTask.type,
    MEDIA_PIPE_TFJS_MODEL,
    MediaPipeTfJsLocal_Embedding
  );
};
