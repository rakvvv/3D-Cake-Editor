import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { HitResult } from '../../interaction/types/interaction-types';
import { DecorationInfo, Axis } from '../../../models/decorationInfo';

interface PlacementResult {
  positionWorld: THREE.Vector3;
  quaternionWorld: THREE.Quaternion;
  positionLocal: THREE.Vector3;
  quaternionLocal: THREE.Quaternion;
  normalWorld: THREE.Vector3;
  normalLocal: THREE.Vector3;
}

@Injectable({ providedIn: 'root' })
export class DecorationPlacementSolverService {
  private readonly worldForward = new THREE.Vector3(0, 0, 1);
  private readonly worldRight = new THREE.Vector3(1, 0, 0);
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  public solvePlacement(
    hit: HitResult,
    decorationInfo: DecorationInfo,
    parent: THREE.Object3D | null,
  ): PlacementResult {
    const pointWorld = (hit.pointWorld ?? hit.point ?? new THREE.Vector3()).clone();
    const normalWorld = (hit.normalWorld ?? hit.normal ?? this.worldUp).clone().normalize();
    const modelUp = this.axisToVector(decorationInfo.modelUpAxis ?? 'Y');
    const modelForward = this.axisToVector(decorationInfo.modelForwardAxis ?? 'Z');

    const alignUp = new THREE.Quaternion().setFromUnitVectors(modelUp, normalWorld);
    const targetForward = this.getTargetForward(hit, decorationInfo, normalWorld, parent);

    const rotatedModelForward = modelForward.clone().applyQuaternion(alignUp);
    const projectedModelForward = this.projectOntoPlane(rotatedModelForward, normalWorld);
    const projectedTargetForward = this.projectOntoPlane(targetForward, normalWorld);

    const twist =
      projectedModelForward.lengthSq() > 1e-6 && projectedTargetForward.lengthSq() > 1e-6
        ? new THREE.Quaternion().setFromUnitVectors(projectedModelForward.normalize(), projectedTargetForward.normalize())
        : new THREE.Quaternion();

    const quaternionWorld = twist.multiply(alignUp).normalize();
    const parentQuat = new THREE.Quaternion();
    parent?.updateMatrixWorld(true);
    parent?.getWorldQuaternion(parentQuat);

    const quaternionLocal = parent
      ? parentQuat.clone().invert().multiply(quaternionWorld).normalize()
      : quaternionWorld.clone();

    const positionLocal = parent ? parent.worldToLocal(pointWorld.clone()) : pointWorld.clone();
    const normalLocal = parent ? normalWorld.clone().applyQuaternion(parentQuat.clone().invert()) : normalWorld.clone();

    return {
      positionWorld: pointWorld,
      quaternionWorld,
      positionLocal,
      quaternionLocal,
      normalWorld,
      normalLocal,
    };
  }

  private axisToVector(axis: Axis): THREE.Vector3 {
    switch (axis) {
      case 'X':
        return new THREE.Vector3(1, 0, 0);
      case 'Z':
        return new THREE.Vector3(0, 0, 1);
      case 'Y':
      default:
        return new THREE.Vector3(0, 1, 0);
    }
  }

  private projectOntoPlane(vector: THREE.Vector3, planeNormal: THREE.Vector3): THREE.Vector3 {
    const projection = planeNormal.clone().multiplyScalar(vector.dot(planeNormal));
    return vector.clone().sub(projection);
  }

  private getTargetForward(
    hit: HitResult,
    decorationInfo: DecorationInfo,
    normalWorld: THREE.Vector3,
    parent: THREE.Object3D | null,
  ): THREE.Vector3 {
    const pointWorld = hit.pointWorld ?? hit.point ?? new THREE.Vector3();
    const outward = parent
      ? pointWorld.clone().sub(parent.getWorldPosition(new THREE.Vector3()))
      : pointWorld.clone();

    const shouldFaceOutward = decorationInfo.faceOutwardOnSides && Math.abs(normalWorld.dot(this.worldUp)) < 0.9;
    if (shouldFaceOutward && outward.lengthSq() > 1e-6) {
      const projected = this.projectOntoPlane(outward.normalize(), normalWorld);
      if (projected.lengthSq() > 1e-6) {
        return projected.normalize();
      }
    }

    const safeForward = Math.abs(normalWorld.dot(this.worldForward)) > 0.99 ? this.worldRight : this.worldForward;
    const projectedForward = this.projectOntoPlane(safeForward.clone(), normalWorld);
    return projectedForward.lengthSq() > 1e-6 ? projectedForward.normalize() : this.worldRight.clone();
  }
}
