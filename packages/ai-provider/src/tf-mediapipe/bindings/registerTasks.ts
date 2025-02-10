import { getAiProviderRegistry } from "@ellmers/ai";
import { DownloadModelTask, TextEmbeddingTask } from "@ellmers/ai";
import {
  MediaPipeTfJsLocal_Download,
  MediaPipeTfJsLocal_Embedding,
} from "../provider/MediaPipeLocalTaskRun";
import { MEDIA_PIPE_TFJS_MODEL } from "..";

export const registerMediaPipeTfJsLocalTasks = () => {
  const aiProviderRegistry = getAiProviderRegistry();

  aiProviderRegistry.registerRunFn(
    DownloadModelTask.type,
    MEDIA_PIPE_TFJS_MODEL,
    MediaPipeTfJsLocal_Download
  );

  aiProviderRegistry.registerRunFn(
    TextEmbeddingTask.type,
    MEDIA_PIPE_TFJS_MODEL,
    MediaPipeTfJsLocal_Embedding
  );
};
