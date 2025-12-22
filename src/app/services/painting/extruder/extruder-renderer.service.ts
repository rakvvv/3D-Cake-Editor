import {Injectable} from '@angular/core';
import * as THREE from 'three';
import {markSceneStroke, PaintingKind} from '../common/painting-metadata';
import {ExtruderVariantData} from './extruder-stroke-builder.service';

export type ExtruderInstanceState = {
  mesh: THREE.InstancedMesh;
  count: number;
};

@Injectable({ providedIn: 'root' })
export class ExtruderRendererService {
  private readonly extruderMaxInstances = 1500;
  private activeExtruderStrokeGroup: THREE.Group | null = null;

  public get maxInstances(): number {
    return this.extruderMaxInstances;
  }

  public resetStrokeState(instances: Map<number, ExtruderInstanceState>): void {
    instances.clear();
    this.activeExtruderStrokeGroup = null;
  }

  public ensureActiveExtruderGroup(scene: THREE.Scene): THREE.Group {
    if (!this.activeExtruderStrokeGroup) {
      this.activeExtruderStrokeGroup = new THREE.Group();
      markSceneStroke(
        this.activeExtruderStrokeGroup,
        'decoration',
        undefined,
        undefined,
        'extruder',
        undefined,
        'DECORATION_STAMP',
      );
      this.activeExtruderStrokeGroup.userData['paintStrokeType'] = 'extruder';
      this.activeExtruderStrokeGroup.userData['snapPoints'] = [] as number[][];
      scene.add(this.activeExtruderStrokeGroup);
    }

    return this.activeExtruderStrokeGroup;
  }

  public ensureExtruderInstanceMesh(
    variantIndex: number,
    variant: ExtruderVariantData,
    strokeGroup: THREE.Group,
    instances: Map<number, ExtruderInstanceState>,
    colorOverride?: string,
  ): ExtruderInstanceState {
    const existing = instances.get(variantIndex);
    if (existing) {
      return existing;
    }

    const mesh = new THREE.InstancedMesh(
      variant.geometry,
      colorOverride ? this.cloneExtruderMaterial(variant.material, colorOverride) : variant.material,
      this.extruderMaxInstances,
    );
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData['isPaintStroke'] = true;
    mesh.userData['variantSourceId'] = variant.sourceId;
    mesh.userData['variantIndex'] = variantIndex;
    strokeGroup.add(mesh);

    const state: ExtruderInstanceState = { mesh, count: 0 };
    instances.set(variantIndex, state);
    return state;
  }

  public teardownExtruderInstances(instances: Map<number, ExtruderInstanceState>): void {
    instances.forEach((state) => {
      state.mesh.geometry.dispose();
      if (Array.isArray(state.mesh.material)) {
        state.mesh.material.forEach((material) => material.dispose());
      } else {
        state.mesh.material.dispose();
      }
      state.mesh.parent?.remove(state.mesh);
    });
    instances.clear();
  }

  private cloneExtruderMaterial(base: THREE.Material, colorOverride?: string): THREE.Material {
    const material = base.clone();
    if (colorOverride && (material as THREE.MeshStandardMaterial).color) {
      (material as THREE.MeshStandardMaterial).color = new THREE.Color(colorOverride);
    }

    return material;
  }
}
