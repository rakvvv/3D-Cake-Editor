export type SidebarPanelKey = 'layers' | 'textures' | 'decorations' | 'presets' | 'paint' | 'export';

export type SidebarPaintMode = 'decor3d' | 'brush' | 'extruder' | 'sprinkles';

export interface BrushSettings {
  size?: number;
  thickness?: number;
  color?: string;
  brushId?: string;
}

export interface SidebarTextureOption {
  id: string;
  name: string;
  preview: string;
  maps: Record<string, unknown>;
}
