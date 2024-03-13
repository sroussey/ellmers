import {
  HuggingFaceLocal_DownloadRun,
  HuggingFaceLocal_EmbeddingRun,
  HuggingFaceLocal_TextGenerationRun,
  HuggingFaceLocal_TextQuestionAnswerRun,
  HuggingFaceLocal_TextRewriterRun,
  HuggingFaceLocal_TextSummaryRun,
} from "provider/local-hugging-face/HuggingFaceLocalTaskRun";
import { ModelProcessorEnum } from "../model/Model";
import { getProviderRegistry } from "../provider/ProviderRegistry";
import {
  DownloadTask,
  EmbeddingTask,
  TextGenerationTask,
  TextQuestionAnswerTask,
  TextRewriterTask,
  TextSummaryTask,
} from "task";

export async function registerHuggingfaceLocalTasks() {
  const ProviderRegistry = getProviderRegistry();

  ProviderRegistry.registerRunFn(
    DownloadTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_DownloadRun
  );

  ProviderRegistry.registerRunFn(
    EmbeddingTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_EmbeddingRun
  );

  ProviderRegistry.registerRunFn(
    TextGenerationTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextGenerationRun
  );

  ProviderRegistry.registerRunFn(
    TextRewriterTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextRewriterRun
  );

  ProviderRegistry.registerRunFn(
    TextSummaryTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextSummaryRun
  );

  ProviderRegistry.registerRunFn(
    TextQuestionAnswerTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextQuestionAnswerRun
  );
}
