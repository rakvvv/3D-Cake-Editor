import * as THREE from 'three';

import { CakeMetadata } from '../../factories/three-objects.factory';
import { SnapInfoSnapshot } from '../snap.service';

export interface DecorationClipboardEntry {
  template: THREE.Object3D;
  worldPosition: THREE.Vector3;
  worldQuaternion: THREE.Quaternion;
  localScale: THREE.Vector3;
  snapInfo: SnapInfoSnapshot | null;
  pasteCount: number;
}

export class ThreeSceneState {
  public objects: THREE.Object3D[] = [];
  public cakeBase: THREE.Group | null = null;
  public cakeLayers: THREE.Mesh[] = [];
  public cakeMetadata: CakeMetadata | null = null;
  public textMesh: THREE.Object3D | null = null;
  public boxHelper: THREE.BoxHelper | null = null;
  public boxHelperTarget: THREE.Object3D | null = null;
  public clipboard: DecorationClipboardEntry | null = null;
  public gridHelper: THREE.GridHelper | null = null;
  public axesHelper: THREE.AxesHelper | null = null;
  public cakeOutlineHelper: THREE.BoxHelper | null = null;
  public boundingBoxesEnabled = false;
  public highQualityMode = true;
  public container?: HTMLElement;
  public ownerDocument?: Document;
  public readonly anchorOccupants = new Map<string, Set<THREE.Object3D>>();
  public lastIsolatedAnchorId: string | null = null;
}
