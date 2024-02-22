import { Model, ModelProcessorEnum, ModelUseCaseEnum } from "./Model";

export class MediaPipeTfJsModel extends Model {
  constructor(
    name: string,
    useCase: ModelUseCaseEnum[],
    public url: string,
    options?: Partial<
      Pick<MediaPipeTfJsModel, "dimensions" | "parameters" | "browserOnly">
    >
  ) {
    super(name, useCase, options);
  }
  readonly type = ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL;
}
