import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { PaintingContext } from '../common/painting-context';
import { markSceneStroke } from '../common/painting-metadata';

@Injectable({ providedIn: 'root' })
export class DecorationRendererService {
  private decorationGroups = new Map<string, THREE.Group>();
  private decorationStrokeInstances = new Map<string, THREE.InstancedMesh[]>();

  public ensureActiveDecorationGroup(context: PaintingContext, brushId: string): THREE.Group | null {
    if (!context.scene) {
      return null;
    }
    const existing = this.decorationGroups.get(brushId);
    if (existing && existing.parent === context.scene) {
      return existing;
    }

    const group = new THREE.Group();
    markSceneStroke(group, 'decoration', undefined, context.projectId, 'decoration', 'Dekoracja malowana');
    group.userData['brushId'] = brushId;
    context.scene.add(group);
    this.decorationGroups.set(brushId, group);
    return group;
  }

  public addDecorationInstances(
    brushId: string,
    variants: { geometry: THREE.BufferGeometry; material: THREE.Material }[],
    decorationGroup: THREE.Group,
    matrix: THREE.Matrix4,
    maxInstances: number,
    selectedIndex?: number,
  ): void {
    const states = this.ensureDecorationInstanceMeshes(brushId, variants, decorationGroup, maxInstances);

    const targetIndex = typeof selectedIndex === 'number' ? selectedIndex : 0;
    const mesh = states[targetIndex];
    if (!mesh) {
      return;
    }
    if (mesh.count >= maxInstances) {
      return;
    }
    mesh.setMatrixAt(mesh.count, matrix);
    mesh.count += 1;
    mesh.instanceMatrix.needsUpdate = true;
  }

  public removeDecorationGroup(brushId: string): void {
    const group = this.decorationGroups.get(brushId);
    if (group?.parent) {
      group.parent.remove(group);
    }
    this.decorationGroups.delete(brushId);
    this.decorationStrokeInstances.delete(brushId);
  }

  public disposeDecorationAssets(brushId: string): void {
    const meshes = this.decorationStrokeInstances.get(brushId) ?? [];
    meshes.forEach((mesh) => {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => mat.dispose());
      } else {
        mesh.material?.dispose();
      }
    });
    this.removeDecorationGroup(brushId);
  }

  private ensureDecorationInstanceMeshes(
    brushId: string,
    variants: { geometry: THREE.BufferGeometry; material: THREE.Material }[],
    decorationGroup: THREE.Group,
    maxInstances: number,
  ): THREE.InstancedMesh[] {
    const existing = this.decorationStrokeInstances.get(brushId);
    if (existing && existing.length === variants.length) {
      const valid = existing.every((mesh) => mesh.parent === decorationGroup && mesh.count < maxInstances);
      if (valid) {
        return existing;
      }
    }

    const meshes = variants.map((variant) => {
      const mesh = new THREE.InstancedMesh(variant.geometry, variant.material, maxInstances);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      markSceneStroke(mesh, 'decoration', undefined, decorationGroup.userData['projectId'], 'decoration');
      mesh.userData['brushId'] = brushId;
      decorationGroup.add(mesh);
      return mesh;
    });

    this.decorationStrokeInstances.set(brushId, meshes);
    return meshes;
  }
}
