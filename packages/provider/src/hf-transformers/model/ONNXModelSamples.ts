import { DATA_TYPES, ONNXTransformerJsModel } from "./ONNXTransformerJsModel";
import { ModelUseCaseEnum } from "ellmers-task-llm";

export const supabaseGteSmall = new ONNXTransformerJsModel(
  "Supabase/gte-small",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 384 }
);

export const baaiBgeBaseEnV15 = new ONNXTransformerJsModel(
  "Xenova/bge-base-en-v1.5",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 768 }
);

export const xenovaMiniL6v2 = new ONNXTransformerJsModel(
  "Xenova/all-MiniLM-L6-v2",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 384 }
);

export const whereIsAIUAELargeV1 = new ONNXTransformerJsModel(
  "WhereIsAI/UAE-Large-V1",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 1024 }
);

export const baaiBgeSmallEnV15 = new ONNXTransformerJsModel(
  "Xenova/bge-small-en-v1.5",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 384 }
);

export const xenovaDistilbert = new ONNXTransformerJsModel(
  "Xenova/distilbert-base-uncased-distilled-squad",
  [ModelUseCaseEnum.TEXT_QUESTION_ANSWERING],
  "question-answering"
);

export const xenovaDistilbertMnli = new ONNXTransformerJsModel(
  "Xenova/distilbert-base-uncased-mnli",
  [ModelUseCaseEnum.TEXT_CLASSIFICATION],
  "zero-shot-classification"
);

export const stentancetransformerMultiQaMpnetBaseDotV1 = new ONNXTransformerJsModel(
  "Xenova/multi-qa-mpnet-base-dot-v1",
  [ModelUseCaseEnum.TEXT_EMBEDDING],
  "feature-extraction",
  { dimensions: 768 }
);

export const gpt2 = new ONNXTransformerJsModel(
  "Xenova/gpt2",
  [ModelUseCaseEnum.TEXT_GENERATION],
  "text-generation"
);

export const distillgpt2 = new ONNXTransformerJsModel(
  "Xenova/distilgpt2",
  [ModelUseCaseEnum.TEXT_GENERATION],
  "text-generation"
);

export const flanT5small = new ONNXTransformerJsModel(
  "Xenova/flan-t5-small",
  [ModelUseCaseEnum.TEXT_GENERATION],
  "text2text-generation"
);

export const flanT5p786m = new ONNXTransformerJsModel(
  "Xenova/LaMini-Flan-T5-783M",
  [ModelUseCaseEnum.TEXT_GENERATION, ModelUseCaseEnum.TEXT_REWRITING],
  "text2text-generation"
);

export const text_summarization = new ONNXTransformerJsModel(
  "Falconsai/text_summarization",
  [ModelUseCaseEnum.TEXT_SUMMARIZATION],
  "summarization",
  { dtype: DATA_TYPES.fp32 }
);

// export const distilbartCnn = new ONNXTransformerJsModel(
//   "Xenova/distilbart-cnn-6-6",
//   [ModelUseCaseEnum.TEXT_SUMMARIZATION],
//   "summarization"
// );

// export const bartLargeCnn = new ONNXTransformerJsModel(
//   "Xenova/bart-large-cnn",
//   [ModelUseCaseEnum.TEXT_SUMMARIZATION],
//   "summarization"
// );

export const nllb200distilled600m = new ONNXTransformerJsModel(
  "Xenova/nllb-200-distilled-600M",
  [ModelUseCaseEnum.TEXT_TRANSLATION],
  "translation",
  { languageStyle: "FLORES-200" }
);

export const m2m100_418M = new ONNXTransformerJsModel(
  "Xenova/m2m100_418M",
  [ModelUseCaseEnum.TEXT_TRANSLATION],
  "translation",
  { languageStyle: "ISO-639" }
);

export const mbartLarge50many2manyMmt = new ONNXTransformerJsModel(
  "Xenova/mbart-large-50-many-to-many-mmt",
  [ModelUseCaseEnum.TEXT_TRANSLATION],
  "translation",
  { languageStyle: "ISO-639_ISO-3166-1-alpha-2" }
);
