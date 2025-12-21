import * as THREE from 'three';

export interface PointerSample {
  xNdc: number;
  yNdc: number;
  buttons: number;
  pressure?: number;
  pointerType?: string;
  modifiers?: {
    alt: boolean;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
  };
  time: number;
  originalEvent?: PointerEvent | MouseEvent | TouchEvent;
}

export interface HitResult {
  point: THREE.Vector3;
  normal?: THREE.Vector3;
  object: THREE.Object3D;
  distance: number;
  face?: THREE.Face;
  uv?: THREE.Vector2;
  /**
   * The raw intersection produced by three.js. Useful for compatibility
   * with legacy paths expecting the original structure.
   */
  rawIntersection?: THREE.Intersection;
}

export interface InteractionContext {
  camera?: THREE.Camera;
  scene?: THREE.Object3D;
  activeLayer?: string | number;
  isTransforming?: boolean;
  enabled?: boolean;
  mode?: string;
  allowStrokeOverPaint?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface SamplingConfig {
  minDistance?: number;
  minDistanceSq?: number;
  minTimeMs?: number;
}

export interface SamplingDecision {
  accepted: boolean;
  reason?: string;
}

export interface Command<TResult = unknown> {
  do(): TResult;
  undo(): TResult;
  description?: string;
}

export enum HistoryDomain {
  Surface = 'surface',
  Decorations = 'decorations',
}
