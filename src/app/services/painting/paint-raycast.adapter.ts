import * as THREE from 'three';
import {RaycastService} from '../interaction/raycast/raycast.service';

const defaultRaycastService = new RaycastService();

export class PaintRaycastAdapter {
  constructor(private readonly raycastService: RaycastService = defaultRaycastService) {}

  public findPaintTarget(raycaster: THREE.Raycaster, target: THREE.Object3D): THREE.Intersection | null {
    const hit = this.raycastService.performRaycast(raycaster, target, {ignorePaintStrokes: true});
    return hit?.rawIntersection ?? null;
  }
}
