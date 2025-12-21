import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { HitResult, PointerSample } from '../../interaction/types/interaction-types';
import { SprinkleShape } from '../../surface-painting.service';

@Injectable({ providedIn: 'root' })
export class SurfaceStrokeBuilderService {
  public createBrushStrokeGroup(
    strokeId: string,
    brushColor: string,
    opacity: number,
    renderOrder: number,
    projectId: string | null,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Smuga';
    group.userData['displayName'] = 'Smuga';
    group.userData['isPaintDecoration'] = true;
    group.userData['isSurfaceStroke'] = true;
    group.userData['strokeIds'] = [strokeId];
    group.userData['kind'] = 'surface-stroke';
    group.userData['subkind'] = 'smear';
    group.userData['projectId'] = projectId ?? undefined;
    group.renderOrder = renderOrder;
    group.userData['color'] = brushColor;
    group.userData['opacity'] = opacity;
    return group;
  }

  public createSprinkleStrokeGroup(
    strokeId: string,
    sprinkleShape: SprinkleShape,
    color: string,
    projectId: string | null,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Posypka';
    group.userData['displayName'] = 'Posypka';
    group.userData['isPaintDecoration'] = true;
    group.userData['isSurfaceStroke'] = true;
    group.userData['strokeIds'] = [strokeId];
    group.userData['kind'] = 'surface-stroke';
    group.userData['subkind'] = 'sprinkle';
    group.userData['projectId'] = projectId ?? undefined;
    group.userData['sprinkleShape'] = sprinkleShape;
    group.userData['color'] = color;
    return group;
  }

  public clonePointerToVector(sample: PointerSample, target: THREE.Vector3): THREE.Vector3 {
    target.set(sample.xNdc ?? 0, sample.yNdc ?? 0, 0);
    return target;
  }

  public copyHitPoint(hit: HitResult | null, target: THREE.Vector3): THREE.Vector3 {
    if (hit?.point) {
      target.copy(hit.point);
    }
    return target;
  }
}
