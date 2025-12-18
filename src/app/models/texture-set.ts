export interface TextureMapsMetadata {
  baseColor?: string | null;
  normal?: string | null;
  roughness?: string | null;
  displacement?: string | null;
  metallic?: string | null;
  emissive?: string | null;
  ambientOcclusion?: string | null;
  alpha?: string | null;
  affectDrips?: boolean | null;
  repeat?: number | null;
}

export interface TextureSet {
  id: string;
  label: string;
  thumbnailUrl?: string | null;
  cake?: TextureMapsMetadata | null;
  glaze?: TextureMapsMetadata | null;
}

export interface TextureIndexDto {
  sets: TextureSet[];
}
