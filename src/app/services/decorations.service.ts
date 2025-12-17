import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { TransformControlsService } from './transform-controls-service';
import { DecorationFactory } from '../factories/decoration.factory';
import { CakeMetadata } from '../factories/three-objects.factory';
import { DecorationInfo } from '../models/decorationInfo';
import { SnapService } from './snap.service';

@Injectable({ providedIn: 'root' })
export class DecorationsService {
  private decorationsInfo: Map<string, DecorationInfo> = new Map();
  private decorations: DecorationInfo[] = [];
  private readonly decorationsSubject = new BehaviorSubject<DecorationInfo[]>([]);
  public readonly decorations$ = this.decorationsSubject.asObservable();

  constructor(
    private transformControlsService: TransformControlsService,
    private snapService: SnapService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  public getDecorations(): DecorationInfo[] {
    return this.decorations;
  }

  public setDecorations(decorations: DecorationInfo[]): void {
    this.decorations = decorations;
    this.decorationsInfo.clear();

    decorations.forEach((decoration) => {
      this.decorationsInfo.set(decoration.modelFileName, decoration);
      this.decorationsInfo.set(decoration.id, decoration);
    });

    this.decorationsSubject.next(this.decorations);
  }

  public getDecorationInfo(identifier: string): DecorationInfo | undefined {
    const existing = this.decorationsInfo.get(identifier);
    if (existing) {
      return existing;
    }

    return this.decorations.find(
      (decoration) => decoration.modelFileName === identifier || decoration.name === identifier,
    );
  }

  public async addDecorationFromModel(
    identifier: string,
    scene: THREE.Scene,
    cakeBase: THREE.Object3D | null,
    objects: THREE.Object3D[],
    preferredSurface?: 'TOP' | 'SIDE',
    targetLayerIndex?: number
  ): Promise<THREE.Object3D | undefined> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (!cakeBase) {
      return;
    }

    let decoInfo = this.decorationsInfo.get(identifier);
    if (!decoInfo) {
      decoInfo = this.decorations.find(d => d.modelFileName === identifier || d.name === identifier);
      if (!decoInfo) {
        console.error('Nie można znaleźć dekoracji o identyfikatorze/nazwie pliku:', identifier);
        return;
      }
    }

    const modelUrl = `/models/${decoInfo.modelFileName}`;
    try {
      const decoration = await DecorationFactory.loadDecorationModel(modelUrl);

      const box = new THREE.Box3().setFromObject(decoration);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const desiredSize = 1.5;
      if (decoInfo.initialScale && decoInfo.initialScale > 0) {
        decoration.scale.setScalar(decoInfo.initialScale);
      } else if (maxDim > 0) {
        const scaleFactor = desiredSize / maxDim;
        decoration.scale.setScalar(scaleFactor);
      }

      if (decoInfo.initialRotation) {
        const [x, y, z] = decoInfo.initialRotation;
        decoration.rotation.set(
          THREE.MathUtils.degToRad(x ?? 0),
          THREE.MathUtils.degToRad(y ?? 0),
          THREE.MathUtils.degToRad(z ?? 0),
        );
      }

      this.applyMaterialOverrides(decoration, decoInfo.material);

      decoration.userData['initialRotation'] = decoration.rotation.clone();
      decoration.userData['initialScale'] = decoration.scale.clone();

      decoration.userData['decorationType'] = decoInfo.type;
      decoration.userData['isDecoration'] = true;
      decoration.userData['modelFileName'] = decoInfo.modelFileName;
      decoration.userData['isSnapped'] = false;

      const metadata = cakeBase.userData['metadata'] as CakeMetadata | undefined;
      const { initialPosition, preferredSurface: resolvedSurface } = this.getInitialPlacement(
        metadata,
        cakeBase,
        decoInfo.type,
        preferredSurface,
        targetLayerIndex
      );

      decoration.position.copy(initialPosition);
      decoration.updateMatrixWorld(true);

      scene.add(decoration);

      if (!objects.includes(decoration)) {
        objects.push(decoration);
      }

      this.transformControlsService.attachObject(decoration);

      const snapResult = this.snapService.snapDecorationToCake(decoration, resolvedSurface);
      if (!snapResult.success) {
        console.warn('Nie udało się automatycznie przyczepić dekoracji:', snapResult.message);
      }

      return decoration;
    } catch (error) {
      console.error(`Błąd ładowania dekoracji ${identifier}:`, error);
      return;
    }
  }

  public applyMaterialOverrides(object: THREE.Object3D, materialConfig?: DecorationInfo['material']): void {
    if (!materialConfig) {
      return;
    }

    object.traverse(child => {
      if (!(child as THREE.Mesh).isMesh) {
        return;
      }

      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach(material => {
        const hasUnlitExtension = !!(material as any).userData?.gltfExtensions?.KHR_materials_unlit;
        if (hasUnlitExtension) {
          return;
        }

        if (materialConfig.roughness !== undefined && 'roughness' in material) {
          (material as any).roughness = materialConfig.roughness;
          material.needsUpdate = true;
        }

        if (materialConfig.metalness !== undefined && 'metalness' in material) {
          (material as any).metalness = materialConfig.metalness;
          material.needsUpdate = true;
        }
      });
    });
  }

  private getInitialPlacement(
    metadata: CakeMetadata | undefined,
    cakeBase: THREE.Object3D,
    type: DecorationInfo['type'],
    preferredSurface?: 'TOP' | 'SIDE',
    targetLayerIndex?: number,
  ): { initialPosition: THREE.Vector3; preferredSurface?: 'TOP' | 'SIDE' } {
    if (!metadata) {
      return {
        initialPosition: new THREE.Vector3().setFromMatrixPosition(cakeBase.matrixWorld),
        preferredSurface: undefined,
      };
    }

    const layerIndex = targetLayerIndex ?? metadata.layerDimensions.length - 1;
    const safeLayerIndex = Math.min(Math.max(layerIndex, 0), metadata.layerDimensions.length - 1);
    const targetLayer = metadata.layerDimensions[safeLayerIndex];
    if (!targetLayer) {
      return {
        initialPosition: new THREE.Vector3().setFromMatrixPosition(cakeBase.matrixWorld),
        preferredSurface: undefined,
      };
    }
    const topY = targetLayer.topY + (metadata.glazeTopOffset ?? 0);
    const midY = (targetLayer.bottomY + topY) / 2;

    const surfacePreference = preferredSurface ?? (type === 'SIDE' ? 'SIDE' : type === 'TOP' ? 'TOP' : undefined);

    if (metadata.shape === 'cylinder') {
      const radius = targetLayer.radius ?? metadata.maxRadius ?? metadata.radius ?? 1;
      const outward = radius + 0.05;

      if (surfacePreference === 'SIDE') {
        const local = new THREE.Vector3(outward, midY, 0);
        return { initialPosition: cakeBase.localToWorld(local), preferredSurface: 'SIDE' };
      }

      if (surfacePreference === 'TOP' || !surfacePreference) {
        const local = new THREE.Vector3(0, topY + 0.05, 0);
        return { initialPosition: cakeBase.localToWorld(local), preferredSurface: surfacePreference ?? undefined };
      }
    }

    const halfWidth = targetLayer.width ? targetLayer.width / 2 : metadata.width ? metadata.width / 2 : 0.5;
    const halfDepth = targetLayer.depth ? targetLayer.depth / 2 : metadata.depth ? metadata.depth / 2 : 0.5;
    const offsetX = halfWidth + 0.05;

    if (surfacePreference === 'SIDE') {
      const local = new THREE.Vector3(offsetX, midY, 0);
      return { initialPosition: cakeBase.localToWorld(local), preferredSurface: 'SIDE' };
    }

    return {
      initialPosition: cakeBase.localToWorld(new THREE.Vector3(0, topY + 0.05, 0)),
      preferredSurface: surfacePreference ?? 'TOP',
    };
  }
}
