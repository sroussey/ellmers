//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

export interface IInstruct {
  name: string;
  documentation: string;
  parameters: Record<string, string | number>;
}
