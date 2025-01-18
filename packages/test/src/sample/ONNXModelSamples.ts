import {
  LOCAL_ONNX_TRANSFORMERJS,
  QUANTIZATION_DATA_TYPES,
} from "ellmers-ai-provider/hf-transformers/browser";
import { getGlobalModelRepository, Model } from "ellmers-ai";

async function addONNXModel(info: Partial<Model>, tasks: string[]) {
  const name = info.name
    ? info.name
    : "ONNX " + info.url + " " + (info.quantization ?? QUANTIZATION_DATA_TYPES.q8);

  const model = Object.assign(
    {
      provider: LOCAL_ONNX_TRANSFORMERJS,
      quantization: QUANTIZATION_DATA_TYPES.q8,
      normalize: true,
      contextWindow: 4096,
      availableOnBrowser: true,
      availableOnServer: true,
      parameters: null,
      languageStyle: null,
      usingDimensions: info.nativeDimensions ?? null,
    },
    info,
    { name }
  ) as Model;

  await getGlobalModelRepository().addModel(model);
  await Promise.allSettled(
    tasks.map((task) => getGlobalModelRepository().connectTaskToModel(task, name))
  );
}

export async function registerHuggingfaceLocalModels(): Promise<void> {
  await addONNXModel(
    {
      pipeline: "feature-extraction",
      nativeDimensions: 384,
      url: "Supabase/gte-small",
    },
    ["TextEmbeddingTask"]
  );

  await addONNXModel(
    {
      pipeline: "feature-extraction",
      nativeDimensions: 768,
      url: "Xenova/bge-base-en-v1.5",
    },
    ["TextEmbeddingTask"]
  );

  await addONNXModel(
    {
      pipeline: "feature-extraction",
      nativeDimensions: 384,
      url: "Xenova/all-MiniLM-L6-v2",
    },
    ["TextEmbeddingTask"]
  );

  await addONNXModel(
    {
      pipeline: "feature-extraction",
      nativeDimensions: 1024,
      url: "WhereIsAI/UAE-Large-V1",
    },
    ["TextEmbeddingTask"]
  );

  await addONNXModel(
    {
      pipeline: "feature-extraction",
      nativeDimensions: 384,
      url: "Xenova/bge-small-en-v1.5",
    },
    ["TextEmbeddingTask"]
  );
  await addONNXModel(
    {
      pipeline: "question-answering",
      url: "Xenova/distilbert-base-uncased-distilled-squad",
    },
    ["TextQuestionAnsweringTask"]
  );

  await addONNXModel(
    {
      pipeline: "zero-shot-classification",
      url: "Xenova/distilbert-base-uncased-mnli",
    },
    ["TextClassificationTask"]
  );

  await addONNXModel(
    {
      pipeline: "fill-mask",
      url: "answerdotai/ModernBERT-base",
    },
    ["TextClassificationTask"]
  );

  await addONNXModel(
    {
      pipeline: "feature-extraction",
      nativeDimensions: 768,
      url: "Xenova/multi-qa-mpnet-base-dot-v1",
    },
    ["TextEmbeddingTask"]
  );

  await addONNXModel(
    {
      pipeline: "text-generation",
      url: "Xenova/gpt2",
    },
    ["TextGenerationTask"]
  );

  await addONNXModel(
    {
      pipeline: "text-generation",
      url: "Xenova/distilgpt2",
    },
    ["TextGenerationTask"]
  );

  await addONNXModel(
    {
      pipeline: "text2text-generation",
      url: "Xenova/flan-t5-small",
    },
    ["TextGenerationTask"]
  );

  await addONNXModel(
    {
      pipeline: "text2text-generation",
      url: "Xenova/LaMini-Flan-T5-783M",
    },
    ["TextGenerationTask"]
  );

  await addONNXModel(
    {
      pipeline: "summarization",
      url: "Falconsai/text_summarization",
    },
    ["TextSummaryTask"]
  );

  await addONNXModel(
    {
      pipeline: "translation",
      url: "Xenova/nllb-200-distilled-600M",
      languageStyle: "FLORES-200",
    },
    ["TextTranslationTask"]
  );

  await addONNXModel(
    {
      pipeline: "translation",
      url: "Xenova/m2m100_418M",
      languageStyle: "ISO-639",
    },
    ["TextTranslationTask"]
  );

  await addONNXModel(
    {
      pipeline: "translation",
      url: "Xenova/mbart-large-50-many-to-many-mmt",
      languageStyle: "ISO-639_ISO-3166-1-alpha-2",
    },
    ["TextTranslationTask"]
  );
}
