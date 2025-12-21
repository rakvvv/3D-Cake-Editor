import * as THREE from 'three';

export class PaintRaycastAdapter {
  public findPaintTarget(raycaster: THREE.Raycaster, target: THREE.Object3D): THREE.Intersection | null {
    const intersects = raycaster.intersectObject(target, true);
    if (!intersects.length) {
      return null;
    }
    return intersects.find((intersection) => !this.isPaintStroke(intersection.object)) ?? intersects[0];
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
