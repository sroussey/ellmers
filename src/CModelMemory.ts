//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { CModel } from "./CModel";
import { IModelList } from "./IModel";

export class CModelMemory extends CModel {
  constructor(
    name: string,
    dimensions: number,
    parameters: Record<string, string | number>
  ) {
    super(name, dimensions, parameters);
  }
}

export const modelList: IModelList = [
  new CModelMemory("Supabase/gte-small", 384, {}),
  new CModelMemory("BAAI/bge-small-en-v1.5", 384, {}),
];
