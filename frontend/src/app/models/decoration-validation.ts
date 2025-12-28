import * as THREE from 'three';
import { DecorationPlacementType } from './decorationInfo';

export type DecorationValidationReason = 'OUTSIDE' | 'TYPE_MISMATCH' | 'NO_CAKE';

export interface DecorationValidationIssue {
  object: THREE.Object3D;
  decorationType?: DecorationPlacementType;
  surfaceType: 'TOP' | 'SIDE' | 'NONE';
  expectedSurfaces: Array<'TOP' | 'SIDE'>;
  distance: number;
  reason: DecorationValidationReason;
}
