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
}
