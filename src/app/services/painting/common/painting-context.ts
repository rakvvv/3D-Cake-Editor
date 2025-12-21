import * as THREE from 'three';

export interface PaintingContext {
  projectId: string | null;
  cakeRoot: THREE.Object3D | null;
  scene: THREE.Scene | null;
  surfaceRoot?: THREE.Group | null;
  onSceneChanged?: () => void;
}
