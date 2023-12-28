//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { IModel } from "./IModel";

export class CModel implements IModel {
  constructor(
    public name: string,
    public dimensions: number,
    public parameters: Record<string, string | number>
  ) {}
}
