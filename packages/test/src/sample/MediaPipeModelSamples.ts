import { MEDIA_PIPE_TFJS_MODEL } from "@ellmers/ai-provider/tf-mediapipe";
import { getGlobalModelRepository, Model } from "@ellmers/ai";

async function addMediaPipeModel(info: Partial<Model>, tasks: string[]) {
  const name = "MEDIAPIPE " + info.name;

  const model = Object.assign(
    {
      provider: MEDIA_PIPE_TFJS_MODEL,
      quantization: null,
      normalize: true,
      contextWindow: 4096,
      availableOnBrowser: true,
      availableOnServer: false,
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

export async function registerMediaPipeTfJsLocalModels(): Promise<void> {
  await addMediaPipeModel(
    {
      name: "Universal Sentence Encoder",
      pipeline: "text_embedder",
      nativeDimensions: 100,
      url: "https://storage.googleapis.com/mediapipe-tasks/text_embedder/universal_sentence_encoder.tflite",
    },
    ["TextEmbeddingTask"]
  );

  await addMediaPipeModel(
    {
      name: "Text Encoder",
      pipeline: "text_embedder",
      nativeDimensions: 100,
      url: "https://huggingface.co/keras-sd/text-encoder-tflite/resolve/main/text_encoder.tflite?download=true",
    },
    ["TextEmbeddingTask"]
  );
}
