//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

export class Model {
  constructor(
    public name: string,
    public dimensions: number,
    public parameters: Record<string, string | number>
  ) {}
}
export type ModelList = Model[];
