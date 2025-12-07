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
  brushStrokes?: SerializedBrushStroke[];
  sprinkleStrokes?: SerializedSprinkleStroke[];
}

export interface SerializedBrushStrokePoint {
  x: number;
  y: number;
  z: number;
  pressure?: number;
}

export interface SerializedBrushStroke {
  id: string;
  mode: 'brush';
  color: string;
  brushSize: number;
  points: SerializedBrushStrokePoint[];
}

export interface SerializedSprinkleStrokePoint {
  x: number;
  y: number;
  z: number;
}

export interface SerializedSprinkleStroke {
  id: string;
  mode: 'sprinkles';
  shape: 'stick' | 'ball' | 'star';
  density: number;
  useRandomColors: boolean;
  color: string;
  points: SerializedSprinkleStrokePoint[];
}
