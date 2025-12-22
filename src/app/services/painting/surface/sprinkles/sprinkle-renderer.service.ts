import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SurfaceStrokeBuilderService } from '../surface-stroke-builder.service';
import { SprinkleShape } from '../../../surface-painting.service';

interface SprinkleStrokeState {
  group: THREE.Group | null;
  mesh: THREE.InstancedMesh | null;
  capacity: number;
  shape: SprinkleShape | null;
}

@Injectable({ providedIn: 'root' })
export class SprinkleRendererService {
  private sprinkleStrokeGroup: THREE.Group | null = null;
  private sprinkleStrokeMesh: THREE.InstancedMesh | null = null;
  private sprinkleStrokeIndex = 0;
  private sprinkleStrokeCapacity = 0;
  private sprinkleStrokeShape: SprinkleShape | null = null;
  private sprinkleGeometryCache: { stick: THREE.BufferGeometry; ball: THREE.BufferGeometry; star: THREE.BufferGeometry } | null
    = null;
  private sprinkleMaterial: THREE.MeshStandardMaterial | null = null;
  private lastUsedSprinkleShape: SprinkleShape | null = null;
  private lastUsedSprinkleColor: string | null = null;

  constructor(
    private readonly surfaceStrokeBuilder: SurfaceStrokeBuilderService,
  ) {}

  public resetBatchState(): void {
    this.sprinkleStrokeGroup = null;
    this.sprinkleStrokeMesh = null;
    this.sprinkleStrokeIndex = 0;
    this.sprinkleStrokeCapacity = 0;
    this.sprinkleStrokeShape = null;
  }

  public canReuseStroke(shape: SprinkleShape, color: string, useRandomColors: boolean): boolean {
    const hasCapacity =
      this.sprinkleStrokeMesh && this.sprinkleStrokeIndex < this.sprinkleStrokeCapacity - 20;
    const isRemoved = !this.sprinkleStrokeGroup || !this.sprinkleStrokeGroup.parent;
    const isSameShape = this.lastUsedSprinkleShape === shape;
    const isSameColor = this.lastUsedSprinkleColor === color || useRandomColors;
    return !!(this.sprinkleStrokeMesh && isSameShape && isSameColor && hasCapacity && !isRemoved);
  }

  public markLastUsed(shape: SprinkleShape, color: string): void {
    this.lastUsedSprinkleShape = shape;
    this.lastUsedSprinkleColor = color;
  }

  public ensureSprinkleStroke(
    anchor: THREE.Group | null,
    options: {
      strokeId: string;
      shape: SprinkleShape;
      color: string;
      useRandomColors: boolean;
      projectId: string | null;
      getRenderOrder: () => number;
    },
  ): { state: SprinkleStrokeState; created: boolean } {
    this.ensureSprinkleResources();

    if (anchor && this.sprinkleStrokeMesh && this.sprinkleStrokeShape === options.shape && this.sprinkleStrokeGroup?.parent) {
      return {
        state: this.currentState(),
        created: false,
      };
    }

    if (!anchor || !this.sprinkleGeometryCache || !this.sprinkleMaterial) {
      return { state: this.currentState(), created: false };
    }

    const capacity = 3000;
    const geometry = this.sprinkleGeometryCache[options.shape];
    const material = this.sprinkleMaterial;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    (mesh as any).raycast = () => {};
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.name = 'Posypka';
    mesh.frustumCulled = false;
    mesh.renderOrder = options.getRenderOrder();

    const group = this.surfaceStrokeBuilder.createSprinkleStrokeGroup(
      options.strokeId,
      options.shape,
      options.useRandomColors ? options.color : options.color,
      options.projectId,
    );
    group.add(mesh);
    anchor.add(group);

    this.sprinkleStrokeGroup = group;
    this.sprinkleStrokeMesh = mesh;
    this.sprinkleStrokeIndex = 0;
    this.sprinkleStrokeCapacity = capacity;
    this.sprinkleStrokeShape = options.shape;
    this.markLastUsed(options.shape, options.color);

    return { state: this.currentState(), created: true };
  }

  public getStrokeIndex(): number {
    return this.sprinkleStrokeIndex;
  }

  public incrementStrokeIndex(): void {
    this.sprinkleStrokeIndex++;
  }

  public getStrokeCapacity(): number {
    return this.sprinkleStrokeCapacity;
  }

  public getStrokeMesh(): THREE.InstancedMesh | null {
    return this.sprinkleStrokeMesh;
  }

  public getStrokeGroup(): THREE.Group | null {
    return this.sprinkleStrokeGroup;
  }

  public updateAfterAdd(startUpdateIndex: number, added: number, isReplaying: boolean): void {
    const mesh = this.sprinkleStrokeMesh;
    if (!mesh || added <= 0 || isReplaying) {
      return;
    }
    mesh.count = this.sprinkleStrokeIndex;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceMatrix.addUpdateRange(startUpdateIndex * 16, added * 16);
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
      mesh.instanceColor.addUpdateRange(startUpdateIndex * 3, added * 3);
    }
    if (this.sprinkleStrokeIndex % 100 === 0) {
      mesh.computeBoundingSphere();
    }
  }

  public syncAfterReplay(): void {
    if (this.sprinkleStrokeMesh) {
      this.sprinkleStrokeMesh.count = this.sprinkleStrokeIndex;
      this.sprinkleStrokeMesh.instanceMatrix.needsUpdate = true;
      if (this.sprinkleStrokeMesh.instanceColor) {
        this.sprinkleStrokeMesh.instanceColor.needsUpdate = true;
      }
      this.sprinkleStrokeMesh.computeBoundingSphere();
    }
  }

  public finalizeStroke(
    finishedStroke: { id: string; pathData: number[]; mode: string } | null,
    projectId: string | null,
  ): { accepted: boolean } {
    const group = this.sprinkleStrokeGroup;
    const mesh = this.sprinkleStrokeMesh;
    if (!group || !mesh) {
      return { accepted: false };
    }

    if (mesh.count === 0) {
      group.parent?.remove(group);
      return { accepted: false };
    }

    let accepted = false;
    const existingIds = (group.userData['strokeIds'] as string[] | undefined) ?? [];
    if (this.sprinkleStrokeIndex > 0) {
      if (finishedStroke?.mode === 'sprinkles' && finishedStroke.pathData.length >= 6) {
        existingIds.push(finishedStroke.id);
        group.userData['strokeIds'] = existingIds;
        group.userData['strokeId'] = finishedStroke.id;
        group.userData['projectId'] = projectId ?? undefined;
        accepted = true;
      } else if (existingIds.length === 0) {
        group.parent?.remove(group);
      }
      mesh.computeBoundingSphere();
    }

    return { accepted };
  }

  public disposeSprinkles(additionalEntries: THREE.Object3D[]): void {
    const allEntries = [...additionalEntries];
    if (this.sprinkleStrokeGroup && !allEntries.includes(this.sprinkleStrokeGroup)) {
      allEntries.push(this.sprinkleStrokeGroup);
    }

    const sharedGeometries = this.sprinkleGeometryCache
      ? new Set<THREE.BufferGeometry>([
        this.sprinkleGeometryCache.stick,
        this.sprinkleGeometryCache.ball,
        this.sprinkleGeometryCache.star,
      ])
      : null;
    const sharedMaterial = this.sprinkleMaterial ?? null;

    allEntries.forEach((entry) => {
      entry.parent?.remove(entry);
      entry.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if ((mesh as { isMesh?: boolean }).isMesh) {
          const geom = mesh.geometry as THREE.BufferGeometry | undefined;
          if (geom && (!sharedGeometries || !sharedGeometries.has(geom))) geom.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => { if (m && m !== sharedMaterial) m.dispose(); });
          } else if (mesh.material && mesh.material !== sharedMaterial) {
            mesh.material.dispose();
          }
        }
      });
    });
    this.resetBatchState();
  }

  public currentState(): SprinkleStrokeState {
    return {
      group: this.sprinkleStrokeGroup,
      mesh: this.sprinkleStrokeMesh,
      capacity: this.sprinkleStrokeCapacity,
      shape: this.sprinkleStrokeShape,
    };
  }

  private ensureSprinkleResources(): void {
    if (!this.sprinkleGeometryCache) {
      this.sprinkleGeometryCache = {
        stick: new THREE.CapsuleGeometry(0.005, 0.024, 4, 8),
        ball: new THREE.SphereGeometry(0.008, 8, 6),
        star: this.createStarGeometry(),
      };
    }
    if (!this.sprinkleMaterial) {
      this.sprinkleMaterial = new THREE.MeshStandardMaterial({
        metalness: 0,
        roughness: 0.18,
        color: 0xffffff,
        emissive: 0x000000,
        roughnessMap: null,
        metalnessMap: null,
        vertexColors: false,
      });
    }
  }

  private createStarGeometry(): THREE.BufferGeometry {
    const points: THREE.Vector2[] = [];
    const spikes = 5;
    const outerRadius = 0.012;
    const innerRadius = 0.0065;
    for (let i = 0; i < spikes * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (spikes * 2)) * Math.PI * 2;
      points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
    }
    const shape = new THREE.Shape(points);
    const extrude = new THREE.ExtrudeGeometry(shape, {
      depth: 0.004,
      bevelEnabled: true,
      bevelThickness: 0.002,
      bevelSize: 0.0015,
      bevelSegments: 2,
    });
    extrude.center();
    if (extrude.index) {
      extrude.toNonIndexed();
    }
    return new THREE.BufferGeometry().copy(extrude);
  }
}
