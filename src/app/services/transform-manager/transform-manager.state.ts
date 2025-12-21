import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export class TransformManagerState {
  public transformControls: TransformControls | null = null;
  public scene: THREE.Scene | null = null;
  public camera: THREE.Camera | null = null;
  public renderer: THREE.WebGLRenderer | null = null;
  public orbit: OrbitControls | null = null;
  public boxHelperCallback: (() => void) | null = null;
  public removeDecorationCallback: ((object: THREE.Object3D) => void) | null = null;
  public copyDecorationCallback: (() => void) | null = null;
  public pasteDecorationCallback: (() => void) | null = null;
  public anchorSnapshotCallback: ((object: THREE.Object3D | null) => void) | null = null;
  public wasDragging = false;
  public cakeSize = 1;
  public lockedSelection: {
    object: THREE.Object3D | null;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  } = {
    object: null,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };

  public setSession(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    orbit: OrbitControls,
  ): void {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.orbit = orbit;
  }

  public resetCallbacks(): void {
    this.boxHelperCallback = null;
    this.removeDecorationCallback = null;
    this.copyDecorationCallback = null;
    this.pasteDecorationCallback = null;
    this.anchorSnapshotCallback = null;
  }
}
