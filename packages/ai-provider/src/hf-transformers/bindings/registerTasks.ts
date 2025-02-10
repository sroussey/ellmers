import {
  getAiProviderRegistry,
  DownloadModelTask,
  TextEmbeddingTask,
  TextGenerationTask,
  TextQuestionAnswerTask,
  TextRewriterTask,
  TextSummaryTask,
  TextTranslationTask,
} from "@ellmers/ai";
import {
  HuggingFaceLocal_DownloadRun,
  HuggingFaceLocal_EmbeddingRun,
  HuggingFaceLocal_TextGenerationRun,
  HuggingFaceLocal_TextQuestionAnswerRun,
  HuggingFaceLocal_TextRewriterRun,
  HuggingFaceLocal_TextSummaryRun,
  HuggingFaceLocal_TextTranslationRun,
} from "../provider/HuggingFaceLocal_TaskRun";
import { LOCAL_ONNX_TRANSFORMERJS } from "../model/ONNXTransformerJsModel";

export async function registerHuggingfaceLocalTasks() {
  const ProviderRegistry = getAiProviderRegistry();

  ProviderRegistry.registerRunFn(
    DownloadModelTask.type,
    LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_DownloadRun
  );

  ProviderRegistry.registerRunFn(
    TextEmbeddingTask.type,
    LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_EmbeddingRun
  );

  ProviderRegistry.registerRunFn(
    TextGenerationTask.type,
    LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextGenerationRun
  );

  ProviderRegistry.registerRunFn(
    TextTranslationTask.type,
    LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextTranslationRun
  );

  ProviderRegistry.registerRunFn(
    TextRewriterTask.type,
    LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextRewriterRun
  );

  ProviderRegistry.registerRunFn(
    TextSummaryTask.type,
    LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextSummaryRun
  );

  ProviderRegistry.registerRunFn(
    TextQuestionAnswerTask.type,
    LOCAL_ONNX_TRANSFORMERJS,
    HuggingFaceLocal_TextQuestionAnswerRun
  );
}
