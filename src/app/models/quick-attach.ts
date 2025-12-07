export type QuickAttachSurface = 'TOP' | 'SIDE';

export interface QuickAttachCoordinates {
  angleRad: number;
  radiusNorm?: number;
  heightNorm?: number;
  xNorm?: number;
  zNorm?: number;
}

export interface QuickAttachPoint {
  id?: string;
  surface: QuickAttachSurface;
  layerIndex?: number;
  coords: QuickAttachCoordinates;
  offset?: number;
  rollRad?: number;
  scale?: number;
}

export interface QuickAttachPatternPreset {
  id: string;
  label: string;
  surface: QuickAttachSurface;
  description?: string;
  decorationId?: string;
  points: QuickAttachPoint[];
}

export interface QuickAttachGridConfig {
  layerIndex?: number;
  rollRad?: number;
  scale?: number;
  offset?: number;
}

export interface QuickAttachSideGridConfig extends QuickAttachGridConfig {
  surface: 'SIDE';
  rows: number;
  columns: number;
  heightStartNorm?: number;
  heightEndNorm?: number;
  startAngleRad?: number;
  endAngleRad?: number;
}

export interface QuickAttachTopGridConfig extends QuickAttachGridConfig {
  surface: 'TOP';
  radii: number[];
  countPerRing: number;
  startAngleRad?: number;
  endAngleRad?: number;
  includeCenter?: boolean;
}
