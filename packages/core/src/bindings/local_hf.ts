import {
  HuggingFaceLocal_DownloadRun,
  HuggingFaceLocal_EmbeddingRun,
  HuggingFaceLocal_TextGenerationRun,
  HuggingFaceLocal_TextQuestionAnswerRun,
  HuggingFaceLocal_TextRewriterRun,
  HuggingFaceLocal_TextSummaryRun,
  HuggingFaceLocal_TextTranslationRun,
} from "provider/local-hugging-face/HuggingFaceLocal_TaskRun";
import { ModelProcessorEnum } from "../model/Model";
import { getProviderRegistry } from "../provider/ProviderRegistry";
import {
  DownloadModelTask,
  TextEmbeddingTask,
  TextGenerationTask,
  TextQuestionAnswerTask,
  TextRewriterTask,
  TextSummaryTask,
  TextTranslationTask,
} from "task";

export async function registerHuggingfaceLocalTasks() {
  const ProviderRegistry = getProviderRegistry();

  ProviderRegistry.registerRunFn(
    DownloadModelTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_DownloadRun
  );

  ProviderRegistry.registerRunFn(
    TextEmbeddingTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_EmbeddingRun
  );

  ProviderRegistry.registerRunFn(
    TextGenerationTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextGenerationRun
  );

  ProviderRegistry.registerRunFn(
    TextTranslationTask.type,
    ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextTranslationRun
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
