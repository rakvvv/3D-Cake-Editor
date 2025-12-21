import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { HitResult } from '../../interaction/types/interaction-types';
import { DecorationInfo } from '../../../models/decorationInfo';

@Injectable({ providedIn: 'root' })
export class DecorationStrokeBuilderService {
  public buildPlacementMatrix(
    hit: HitResult,
    decorationInfo: DecorationInfo,
    scale: number,
    penSurfaceOffset: number,
    tempObject: THREE.Object3D,
  ): THREE.Matrix4 {
    const cakeCenterWorld = new THREE.Vector3();
    hit.object?.getWorldPosition(cakeCenterWorld);
    this.applySurfacePlacement(tempObject, hit, decorationInfo, cakeCenterWorld, penSurfaceOffset);
    return new THREE.Matrix4().compose(
      tempObject.position.clone(),
      tempObject.quaternion.clone(),
      new THREE.Vector3(scale, scale, scale),
    );
  }

  private applySurfacePlacement(
    decoRoot: THREE.Object3D,
    hit: HitResult,
    decorationInfo: DecorationInfo,
    cakeCenterWorld: THREE.Vector3,
    penSurfaceOffset: number,
  ): void {
    const { point, normal } = hit;
    decoRoot.position.copy(point ?? new THREE.Vector3());
    if (normal) {
      decoRoot.lookAt(point!.clone().add(normal));
      decoRoot.rotateX(-Math.PI / 2);
    }
    if (decorationInfo.initialRotation) {
      decoRoot.rotation.set(
        decorationInfo.initialRotation[0],
        decorationInfo.initialRotation[1],
        decorationInfo.initialRotation[2],
      );
    }
    if (decorationInfo.initialScale) {
      decoRoot.scale.setScalar(decorationInfo.initialScale);
    }
    decoRoot.position.addScaledVector(normal ?? new THREE.Vector3(0, 1, 0), penSurfaceOffset);
    decoRoot.position.sub(cakeCenterWorld);
  }
}
