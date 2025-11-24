export interface CakeOptions {
  cake_size: number;
  cake_color: string;
  cake_text: boolean;
  cake_text_value: string;
  cake_text_position: 'top' | 'side';
  cake_text_offset: number;
  cake_text_font: string;
  cake_text_depth: number;
  layers: number;
  shape: 'cylinder' | 'cuboid';
  layerSizes: number[];
  glaze_enabled: boolean;
  glaze_color: string;
  glaze_thickness: number;
  glaze_drip_length: number;
  glaze_seed: number;
  wafer_texture_url: string | null;
  wafer_scale: number;
  wafer_texture_zoom: number;
  wafer_texture_offset_x: number;
  wafer_texture_offset_y: number;
}
