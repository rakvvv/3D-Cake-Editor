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
  penOpacity?: number;
  penCapsEnabled?: boolean;
  variantSourceId?: string;
  variantIndex?: number;
  groupMatrix?: number[];
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

export interface SerializedBrushStroke {
  id: string;
  mode: 'brush';
  color: string;
  brushSize: number;
  /**
   * Flattened array of position + normal tuples:
   * [x, y, z, nx, ny, nz, x, y, z, nx, ny, nz, ...]
   */
  pathData: number[];
}

export interface SerializedSprinkleStroke {
  id: string;
  mode: 'sprinkles';
  shape: 'stick' | 'ball' | 'star';
  density: number;
  useRandomColors: boolean;
  color: string;
  /** Optional packed representation (base64) of quantized path data for compact storage. */
  pathPacked?: string;
  /** Optional deterministic seed for sprinkle randomness; falls back to legacy behavior if absent. */
  strokeSeed?: number;
  /**
   * Flattened array of position + normal tuples:
   * [x, y, z, nx, ny, nz, x, y, z, nx, ny, nz, ...]
   */
  pathData?: number[];
}
