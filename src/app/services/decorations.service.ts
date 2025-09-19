import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { TransformControlsService } from './transform-controls-service';
import { ThreeObjectsFactory } from './three-objects.factory';
import { DecorationInfo } from '../models/decorationInfo';

@Injectable({ providedIn: 'root' })
export class DecorationsService {
  private decorationsInfo: Map<string, DecorationInfo> = new Map();
  private decorations: DecorationInfo[] = [];

  constructor(
    private http: HttpClient,
    private transformControlsService: TransformControlsService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.loadDecorationsData();
  }

  public getDecorations(): DecorationInfo[] {
    return this.decorations;
  }

  private async loadDecorationsData(): Promise<void> {
    try {
      const decorationsFromApi: DecorationInfo[] = [
        { name: 'Cyfra 1', modelFileName: 'Numer_1.glb', type: 'TOP' },
        { name: 'Ozdoba Boczna', modelFileName: 'custom.glb', type: 'SIDE' },
        { name: 'czekoladowa ozdoba', modelFileName: 'chocolate_kiss.glb', type: 'TOP' },
        { name: 'Trawa', modelFileName: 'trawa.glb', type: 'SIDE' }
      ];
      this.decorations = decorationsFromApi;
      decorationsFromApi.forEach(dec => {
        this.decorationsInfo.set(dec.modelFileName, dec);
      });
    } catch (error) {
      console.error('Błąd ładowania danych dekoracji z API:', error);
    }
  }

  public async addDecorationFromModel(
    identifier: string,
    scene: THREE.Scene,
    cakeBase: THREE.Mesh,
    objects: THREE.Object3D[]
  ): Promise<THREE.Object3D | undefined> {
    if (!isPlatformBrowser(this.platformId)) {
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
      const decoration = await ThreeObjectsFactory.loadDecorationModel(modelUrl);

      const box = new THREE.Box3().setFromObject(decoration);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const desiredSize = 1.5;
      if (maxDim > 0) {
        const scaleFactor = desiredSize / maxDim;
        decoration.scale.setScalar(scaleFactor);
      }

      decoration.userData['decorationType'] = decoInfo.type;
      decoration.userData['modelFileName'] = decoInfo.modelFileName;
      decoration.userData['isSnapped'] = false;

      decoration.position.set(
        (Math.random() - 0.5) * 5,
        cakeBase.position.y + (cakeBase.geometry as THREE.CylinderGeometry).parameters.height * cakeBase.scale.y + 2 + Math.random(),
        (Math.random() - 0.5) * 5
      );

      scene.add(decoration);
      const meshes = (decoration.userData['clickableMeshes'] as THREE.Mesh[]) ?? [];
      objects.push(...meshes);

      this.transformControlsService.attachObject(decoration);
      return decoration;
    } catch (error) {
      console.error(`Błąd ładowania dekoracji ${identifier}:`, error);
      return;
    }
  }
}
