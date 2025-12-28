import * as THREE from 'three';

export interface ClosestPointInfo {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  surfaceType: 'TOP' | 'SIDE' | 'NONE';
  layerIndex: number;
}
