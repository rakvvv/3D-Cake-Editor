export type DecorationPlacementType = 'TOP' | 'SIDE' | 'BOTH';

export interface DecorationInfo {
  name: string;
  modelFileName: string;
  type: DecorationPlacementType;
}
