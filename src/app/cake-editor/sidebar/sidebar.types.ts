import { TextureMaps } from '../../models/cake.options';

export type SidebarPanelKey = 'decorations' | 'presets' | 'paint';

export type SidebarPaintMode = 'decor3d' | 'brush' | 'pen' | 'extruder' | 'sprinkles';

export interface BrushSettings {
  size?: number;
  thickness?: number;
  color?: string;
  brushId?: string;
  opacity?: number;
}

export interface SidebarTextureOption {
  id: string;
  name: string;
  preview: string;
  maps: TextureMaps;
}
