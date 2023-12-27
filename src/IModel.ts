//    ****************************************************************************
//    *   ELMERS: Embedding Language Model Experiental Retreival Service         *
//    *                                                                          *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                          *
//    ****************************************************************************

export interface IModel {
  name: string;
  dimensions: number;
  parameters: Record<string, string | number>;
}
