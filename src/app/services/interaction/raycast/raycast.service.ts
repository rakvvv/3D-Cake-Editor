import {Injectable} from '@angular/core';
import * as THREE from 'three';
import {HitResult} from '../types/interaction-types';

export interface RaycastOptions {
  recursive?: boolean;
  ignorePaintStrokes?: boolean;
  filter?: (intersection: THREE.Intersection) => boolean;
}

@Injectable({providedIn: 'root'})
export class RaycastService {
  public performRaycast(
    raycaster: THREE.Raycaster,
    target: THREE.Object3D,
    options?: RaycastOptions,
  ): HitResult | null {
    target.updateMatrixWorld(true);
    const recursive = options?.recursive ?? true;
    const intersections = raycaster.intersectObject(target, recursive);
    if (!intersections.length) {
      return null;
    }

    const filtered = intersections.find((intersection) => {
      if (options?.ignorePaintStrokes && this.isPaintStroke(intersection.object)) {
        return false;
      }
      return options?.filter ? options.filter(intersection) : true;
    });

    const selected = filtered ?? intersections[0];
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(selected.object.matrixWorld);
    const normalWorld = selected.face?.normal
      ? selected.face.normal.clone().applyMatrix3(normalMatrix).normalize()
      : undefined;
    const pointWorld = selected.point.clone();
    return {
      point: pointWorld.clone(),
      pointWorld,
      normal: normalWorld ?? selected.face?.normal?.clone(),
      normalWorld,
      object: selected.object,
      distance: selected.distance,
      face: selected.face ?? undefined,
      uv: selected.uv?.clone(),
      rawIntersection: selected,
    };
  }

  private isPaintStroke(object: THREE.Object3D | null): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData?.['isPaintStroke'] || current.userData?.['isSurfaceStroke']) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }
}
