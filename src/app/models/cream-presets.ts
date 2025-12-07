import { MathUtils } from 'three';

export type CreamPosition = 'TOP_EDGE' | 'BOTTOM_EDGE' | 'SIDE_ARC';

export type CreamRingPreset = {
  id: string;
  name: string;
  layerIndex: number;
  position: CreamPosition;
  segments: number;
  startAngleDeg?: number;
  endAngleDeg?: number;
  heightNorm?: number;
  radiusOffset?: number;
  scale?: number;
  color?: string;
};

const defaultTopLayer = -1;

export const defaultCreamRingPresets: CreamRingPreset[] = [
  {
    id: 'top-rim',
    name: 'Korona górnej krawędzi',
    layerIndex: defaultTopLayer,
    position: 'TOP_EDGE',
    segments: 90,
    heightNorm: 1,
    radiusOffset: 0.025,
    scale: 1.05,
  },
  {
    id: 'front-arc',
    name: 'Półłuk z przodu',
    layerIndex: defaultTopLayer,
    position: 'SIDE_ARC',
    segments: 56,
    startAngleDeg: -120,
    endAngleDeg: 120,
    heightNorm: 0.55,
    radiusOffset: 0.035,
    color: '#ffe8ef',
  },
  {
    id: 'bottom-band',
    name: 'Pierścień u podstawy',
    layerIndex: 0,
    position: 'BOTTOM_EDGE',
    segments: 72,
    heightNorm: 0.08,
    radiusOffset: 0.045,
    scale: 0.95,
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
