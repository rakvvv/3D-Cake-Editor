import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { TransformControlsService } from './transform-controls-service';
import { DecorationFactory } from '../factories/decoration.factory';
import { CakeMetadata } from '../factories/three-objects.factory';
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
        { name: 'Czekoladowa ozdoba', modelFileName: 'chocolate_kiss.glb', type: 'BOTH' },
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
    cakeBase: THREE.Object3D | null,
    objects: THREE.Object3D[]
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
      if (maxDim > 0) {
        const scaleFactor = desiredSize / maxDim;
        decoration.scale.setScalar(scaleFactor);
      }

      decoration.userData['decorationType'] = decoInfo.type;
      decoration.userData['isDecoration'] = true;
      decoration.userData['modelFileName'] = decoInfo.modelFileName;
      decoration.userData['isSnapped'] = false;

      const metadata = cakeBase.userData['metadata'] as CakeMetadata | undefined;
      const worldScale = cakeBase.getWorldScale(new THREE.Vector3());
      const topHeight = metadata
        ? metadata.totalHeight * worldScale.y
        : cakeBase.position.y + 2;

      decoration.position.set(
        (Math.random() - 0.5) * 5,
        topHeight + 2 + Math.random(),
        (Math.random() - 0.5) * 5
      );

      scene.add(decoration);

      if (!objects.includes(decoration)) {
        objects.push(decoration);
      }

      this.transformControlsService.attachObject(decoration);
      return decoration;
    } catch (error) {
      console.error(`Błąd ładowania dekoracji ${identifier}:`, error);
      return;
    }
  }
}
