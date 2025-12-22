import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { PaintingContext } from '../common/painting-context';
import { markSceneStroke } from '../common/painting-metadata';

@Injectable({ providedIn: 'root' })
export class SurfaceStrokeRendererService {
  private surfaceRoot: THREE.Group | null = null;
  private strokeGroup: THREE.Group | null = null;
  private sprinkleGroup: THREE.Group | null = null;

  public ensureSurfaceRoot(context: PaintingContext): THREE.Group | null {
    const cakeRoot = context.cakeRoot;
    if (!cakeRoot) {
      return null;
    }

    if (this.surfaceRoot && this.surfaceRoot.parent === cakeRoot) {
      return this.surfaceRoot;
    }

    const root = new THREE.Group();
    root.name = 'surface-root';
    markSceneStroke(root, 'surface', undefined, context.projectId, 'surface-root');
    cakeRoot.add(root);
    this.surfaceRoot = root;
    return root;
  }

  public addBrushStroke(context: PaintingContext, stroke: THREE.Group): void {
    const root = this.ensureSurfaceRoot(context);
    if (!root) {
      return;
    }
    markSceneStroke(stroke, 'surface', stroke.userData['strokeId'], context.projectId, 'smear');
    root.add(stroke);
    this.strokeGroup = stroke;
    context.onSceneChanged?.();
  }

  public removeBrushStroke(context: PaintingContext, stroke: THREE.Group): void {
    if (stroke.parent) {
      stroke.parent.remove(stroke);
    }
    if (this.strokeGroup === stroke) {
      this.strokeGroup = null;
    }
    context.onSceneChanged?.();
  }

  public addSprinkleStroke(context: PaintingContext, stroke: THREE.Group): void {
    const root = this.ensureSurfaceRoot(context);
    if (!root) {
      return;
    }
    markSceneStroke(stroke, 'surface', stroke.userData['strokeId'], context.projectId, 'sprinkle');
    root.add(stroke);
    this.sprinkleGroup = stroke;
    context.onSceneChanged?.();
  }

  public removeSprinkleStroke(context: PaintingContext, stroke: THREE.Group): void {
    if (stroke.parent) {
      stroke.parent.remove(stroke);
    }
    if (this.sprinkleGroup === stroke) {
      this.sprinkleGroup = null;
    }
    context.onSceneChanged?.();
  }

  public disposeSurfaceStroke(stroke: THREE.Group | null): void {
    if (!stroke) {
      return;
    }
    stroke.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });
    stroke.parent?.remove(stroke);
  }
}
