import {SprinkleColorMode, SprinkleShape} from '../services/surface-painting.service';

export interface PaintData {
  brushMatrices: Float32Array[]; // Tablica macierzy dla pędzla
  brushColors: number[];         // Kolory pędzla (jako hex)
  sprinkleMatrices: Float32Array[];
  sprinkleColors: Float32Array[];
  sprinkleShape: SprinkleShape;
  sprinkleColorMode?: SprinkleColorMode;
}
