import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { HitResult } from '../../interaction/types/interaction-types';
import { DecorationInfo } from '../../../models/decorationInfo';
import { DecorationPlacementSolverService } from './decoration-placement-solver.service';

@Injectable({ providedIn: 'root' })
export class DecorationStrokeBuilderService {
  constructor(private readonly placementSolver: DecorationPlacementSolverService) {}

  public buildPlacementMatrix(
    hit: HitResult,
    decorationInfo: DecorationInfo,
    scale: number,
    penSurfaceOffset: number,
    parent: THREE.Object3D | null,
  ): THREE.Matrix4 {
    const placement = this.placementSolver.solvePlacement(hit, decorationInfo, parent);

    const positionLocal = placement.positionLocal.clone();
    if (placement.normalLocal && penSurfaceOffset) {
      positionLocal.addScaledVector(placement.normalLocal, penSurfaceOffset);
    }

    const rotationOffset = decorationInfo.initialRotation
      ? new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            decorationInfo.initialRotation[0],
            decorationInfo.initialRotation[1],
            decorationInfo.initialRotation[2],
          ),
        )
      : null;
    const quaternion = rotationOffset
      ? placement.quaternionLocal.clone().multiply(rotationOffset)
      : placement.quaternionLocal.clone();

    return new THREE.Matrix4().compose(positionLocal, quaternion, new THREE.Vector3(scale, scale, scale));
  }
}
