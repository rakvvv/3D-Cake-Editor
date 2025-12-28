export type DecorationSurfaceTarget = 'AUTO' | 'TOP' | 'SIDE';

export interface AddDecorationRequest {
  modelFileName: string;
  preferredSurface?: 'TOP' | 'SIDE';
  targetLayerIndex?: number;
}
