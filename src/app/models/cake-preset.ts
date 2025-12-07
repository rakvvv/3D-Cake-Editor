import { CakeOptions } from './cake.options';
import { SnapInfoSnapshot } from '../services/snap.service';

export interface DecorationPresetEntry {
  modelFileName: string;
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  snapInfo?: SnapInfoSnapshot;
  anchorId?: string;
}

export interface DecoratedCakePreset {
  id: string;
  name: string;
  description?: string;
  thumbnailUrl?: string;
  options: CakeOptions;
  decorations: DecorationPresetEntry[];
  paintStrokes?: PaintStrokePreset[];
  surfacePainting?: SurfacePaintingPreset;
}

export interface PaintStrokePreset {
  type: 'extruder' | 'pen' | 'decoration';
  color?: string;
  brushId?: string;
  penSize?: number;
  penThickness?: number;
  penCapsEnabled?: boolean;
  variantSourceId?: string;
  variantIndex?: number;
  instances: PaintStrokeInstance[];
  snapPoints?: number[][];
  name?: string;
}

export interface PaintStrokeInstance {
  matrix: number[];
  color?: number[];
  penPart?: 'segment' | 'joint' | 'cap';
}

export interface SurfacePaintingPreset {
  brushColor?: string;
  brushEntries: SurfaceBrushEntry[];
  sprinkles: SurfaceSprinkleEntry[];
}

export interface SurfaceBrushEntry {
  matrices: number[][];
  color?: string;
}

export interface SurfaceSprinkleEntry {
  matrices: number[][];
  colors: number[][];
  shape: 'stick' | 'ball' | 'star';
}
