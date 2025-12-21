import {Injectable} from '@angular/core';
import * as THREE from 'three';
import {HitResult, InteractionContext, PolicyDecision} from '../types/interaction-types';

@Injectable({providedIn: 'root'})
export class InteractionPolicyService {
  public canInteract(hit: HitResult | null, context?: InteractionContext): PolicyDecision {
    if (context?.enabled === false) {
      return {allowed: false, reason: 'interaction-disabled'};
    }
    if (context?.isTransforming) {
      return {allowed: false, reason: 'transform-in-progress'};
    }
    if (!hit) {
      return {allowed: false, reason: 'no-hit'};
    }
    if (context?.activeLayer !== undefined && hit.object.userData?.layer !== undefined) {
      if (hit.object.userData.layer !== context.activeLayer) {
        return {allowed: false, reason: 'layer-mismatch'};
      }
    }
    if (context?.allowStrokeOverPaint === false && this.isPaintStroke(hit.object)) {
      return {allowed: false, reason: 'raycast-blocked-by-paint'};
    }
    return {allowed: true};
  }

  private isPaintStroke(object: THREE.Object3D | null): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData?.['isPaintStroke'] || current.userData?.['isSurfaceStroke']) {
        return true;
      }
      current = current.parent ?? null;
    }
    return false;
  }
}
