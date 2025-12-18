export type DecorationPlacementType = 'TOP' | 'SIDE' | 'BOTH';
export type Axis = 'X' | 'Y' | 'Z';

export interface DecorationInfo {
  id: string;
  name: string;
  modelFileName: string;
  type: DecorationPlacementType;
  thumbnailUrl?: string;
  paintable?: boolean;
  initialScale?: number;
  material?: {
    roughness?: number;
    metalness?: number;
  };
  initialRotation?: [number, number, number];
  paintInitialRotation?: [number, number, number];
  surfaceOffset?: number;
  modelUpAxis?: Axis;
  modelForwardAxis?: Axis;
  faceOutwardOnSides?: boolean;
}
