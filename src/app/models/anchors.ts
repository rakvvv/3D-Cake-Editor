export type AnchorSurface = 'TOP' | 'SIDE';

export interface AnchorSurfaceCoordinates {
  angleRad: number;
  radiusNorm?: number;
  heightNorm?: number;
  xNorm?: number;
  zNorm?: number;
}

export interface AnchorPoint {
  id: string;
  label?: string;
  surface: AnchorSurface;
  layerIndex: number;
  coordinates: AnchorSurfaceCoordinates;
  defaultRotationDeg?: number;
  defaultScale?: number;
  allowedDecorationIds?: string[];
  decorationOverrides?: Record<
    string,
    {
      rotationDeg?: number;
      scale?: number;
      offset?: [number, number, number];
    }
  >;
}

export interface AnchorPreset {
  id: string;
  name: string;
  cakeShape?: string;
  cakeSize?: string;
  tiers?: number;
  anchors: AnchorPoint[];
}
