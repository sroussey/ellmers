//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

import { IInstruct } from "./IInstruct";

export class CInstruct implements IInstruct {
  constructor(
    public name: string,
    public documentation: string,
    public queryInstruction: string,
    public storageInstruction: string,
    public parameters: Record<string, string | number>
  ) {}
}
