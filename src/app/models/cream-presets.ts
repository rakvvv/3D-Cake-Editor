import { MathUtils } from 'three';

export type CreamPosition = 'TOP_EDGE' | 'BOTTOM_EDGE' | 'SIDE_ARC';

export type ExtruderStrokeMode = 'RING' | 'ARC' | 'PATH';

export type CreamPathNode = {
  angleDeg: number;
  heightNorm?: number;
};

export type CreamRingPreset = {
  id: string;
  name: string;
  mode: ExtruderStrokeMode;
  layerIndex: number;
  position: CreamPosition;
  segments?: number;
  startAngleDeg?: number;
  endAngleDeg?: number;
  heightNorm?: number;
  radiusOffset?: number;
  scale?: number;
  color?: string;
  nodes?: CreamPathNode[];
};

const defaultTopLayer = -1;

export const defaultCreamRingPresets: CreamRingPreset[] = [
  {
    id: 'top-rim',
    name: 'Korona górnej krawędzi',
    mode: 'RING',
    layerIndex: defaultTopLayer,
    position: 'TOP_EDGE',
    segments: 96,
    heightNorm: 1,
    radiusOffset: 0.02,
    scale: 1.05,
  },
  {
    id: 'front-arc',
    name: 'Półłuk z przodu',
    mode: 'ARC',
    layerIndex: defaultTopLayer,
    position: 'SIDE_ARC',
    segments: 64,
    startAngleDeg: -120,
    endAngleDeg: 120,
    heightNorm: 0.55,
    radiusOffset: 0.03,
    color: '#ffe8ef',
  },
  {
    id: 'top-wave-path',
    name: 'Fala na górze (punkty)',
    mode: 'PATH',
    layerIndex: defaultTopLayer,
    position: 'TOP_EDGE',
    segments: 64,
    heightNorm: 1,
    radiusOffset: 0.015,
    nodes: [
      { angleDeg: -150, heightNorm: 1 },
      { angleDeg: 0, heightNorm: 1 },
      { angleDeg: 130, heightNorm: 1 },
    ],
  },
  {
    id: 'wave-path',
    name: 'Ścieżka łącząca punkty',
    mode: 'PATH',
    layerIndex: 0,
    position: 'SIDE_ARC',
    segments: 48,
    heightNorm: 0.6,
    radiusOffset: 0.02,
    nodes: [
      { angleDeg: -150, heightNorm: 0.55 },
      { angleDeg: 0, heightNorm: 0.65 },
      { angleDeg: 160, heightNorm: 0.5 },
    ],
  },
];

export function normalizePresetAngles(preset: CreamRingPreset): CreamRingPreset {
  const startAngleDeg = preset.startAngleDeg ?? 0;
  const endAngleDeg = preset.endAngleDeg ?? 360;
  const normalizedStart = MathUtils.euclideanModulo(startAngleDeg, 360);
  const delta = endAngleDeg - startAngleDeg;
  const normalizedEnd = normalizedStart + (Math.abs(delta) < 1e-6 ? 360 : delta);

  return {
    ...preset,
    startAngleDeg: normalizedStart,
    endAngleDeg: normalizedEnd,
  };
}
