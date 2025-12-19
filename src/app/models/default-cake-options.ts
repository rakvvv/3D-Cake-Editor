import { CakeOptions } from './cake.options';

export const DEFAULT_CAKE_OPTIONS: CakeOptions = {
  cake_size: 1,
  cake_color: '#ffffff',
  cake_text: false,
  cake_text_value: 'Urodziny',
  cake_text_position: 'top',
  cake_text_offset: 0,
  cake_text_font: 'helvetiker',
  cake_text_depth: 0.1,
  layers: 1,
  shape: 'cylinder',
  layerSizes: [1],
  glaze_enabled: false,
  glaze_color: '#ffffff',
  glaze_thickness: 0.1,
  glaze_drip_length: 1.2,
  glaze_seed: 1,
  glaze_top_enabled: false,
  cake_textures: null,
  glaze_textures: null,
  wafer_texture_url: null,
  wafer_scale: 1,
  wafer_texture_zoom: 1,
  wafer_texture_offset_x: 0,
  wafer_texture_offset_y: 0,
};

export function cloneCakeOptions(options: CakeOptions): CakeOptions {
  return JSON.parse(JSON.stringify(options));
}
