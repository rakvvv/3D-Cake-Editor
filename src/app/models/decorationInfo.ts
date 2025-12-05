export type DecorationPlacementType = 'TOP' | 'SIDE' | 'BOTH';

export interface DecorationInfo {
  id: string;
  name: string;
  modelFileName: string;
  type: DecorationPlacementType;
  thumbnailUrl?: string;
  paintable?: boolean;
}
