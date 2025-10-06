import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import * as THREE from 'three';

import { ThreeSceneService } from './three-scene.service';
import { TransformControlsService } from './transform-controls-service';
import { SceneInitService } from './scene-init.service';
import { DecorationsService } from './decorations.service';
import { PaintService } from './paint.service';
import { ExportService } from './export.service';
import { SnapService } from './snap.service';

class TransformControlsServiceStub {
  private selected: THREE.Object3D | null = null;

  public init(): void {}
  public updateCakeSize(): void {}
  public setTransformMode(): void {}
  public isDragging(): boolean { return false; }
  public dispose(): void {}

  public attachObject(object: THREE.Object3D): void {
    this.selected = object;
  }

  public getSelectedObject(): THREE.Object3D | null {
    return this.selected;
  }

  public deselectObject(): void {
    this.selected = null;
  }

  public clearSelection(): void {
    this.selected = null;
  }

  public setSelectedObject(object: THREE.Object3D | null): void {
    this.selected = object;
  }
}

describe('ThreeSceneService', () => {
  let service: ThreeSceneService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ThreeSceneService,
        { provide: TransformControlsService, useClass: TransformControlsServiceStub },
        SceneInitService,
        DecorationsService,
        PaintService,
        ExportService,
        SnapService,
      ]
    });
    service = TestBed.inject(ThreeSceneService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('removes decoration from tracked objects', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    (sceneInit as any).scene = new THREE.Scene();

    const decoration = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );

    sceneInit.scene.add(decoration);
    service.objects.push(decoration);

    service.removeDecoration(decoration);

    expect(service.objects).not.toContain(decoration);
    expect(sceneInit.scene.children).not.toContain(decoration);
  });

  it('copies and pastes a decoration', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    (sceneInit as any).scene = new THREE.Scene();

    const decoration = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );

    sceneInit.scene.add(decoration);
    service.objects.push(decoration);

    const transformStub = TestBed.inject(TransformControlsService) as unknown as TransformControlsServiceStub;
    transformStub.setSelectedObject(decoration);

    const copyResult = service.copySelectedDecoration();
    expect(copyResult.success).toBeTrue();
    expect(service.hasCopiedDecoration()).toBeTrue();

    const pasteResult = service.pasteDecoration();
    expect(pasteResult.success).toBeTrue();
    expect(service.objects.length).toBe(2);

    const selectedAfterPaste = transformStub.getSelectedObject();
    expect(selectedAfterPaste).toBeTruthy();
    expect(selectedAfterPaste).not.toBe(decoration);

    if (selectedAfterPaste) {
      expect(sceneInit.scene.children).toContain(selectedAfterPaste);
    }
  });
});
