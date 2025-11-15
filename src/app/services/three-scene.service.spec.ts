import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import * as THREE from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';

import { ThreeSceneService } from './three-scene.service';
import { TransformControlsService } from './transform-controls-service';
import { SceneInitService } from './scene-init.service';
import { DecorationsService } from './decorations.service';
import { PaintService } from './paint.service';
import { ExportService } from './export.service';
import { SnapService } from './snap.service';
import { TextFactory } from '../factories/text.factory';
import { CakeMetadata } from '../factories/three-objects.factory';

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

  it('deselects selected decoration and reports status', () => {
    const transformStub = TestBed.inject(TransformControlsService) as unknown as TransformControlsServiceStub;
    const decoration = new THREE.Object3D();
    transformStub.setSelectedObject(decoration);

    expect(service.deselectDecoration()).toBeTrue();
    expect(transformStub.getSelectedObject()).toBeNull();
    expect(service.deselectDecoration()).toBeFalse();
  });

  it('detects snapped selection state', () => {
    const transformStub = TestBed.inject(TransformControlsService) as unknown as TransformControlsServiceStub;
    const cakeBase = new THREE.Group();
    const decoration = new THREE.Object3D();
    cakeBase.add(decoration);

    service.cakeBase = cakeBase;
    transformStub.setSelectedObject(decoration);

    expect(service.isSelectedDecorationSnapped()).toBeTrue();

    cakeBase.remove(decoration);
    const freeDecoration = new THREE.Object3D();
    transformStub.setSelectedObject(freeDecoration);

    expect(service.isSelectedDecorationSnapped()).toBeFalse();

    freeDecoration.userData['isSnapped'] = true;
    expect(service.isSelectedDecorationSnapped()).toBeTrue();
  });

  it('delegates camera reset to scene init service', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    spyOn(sceneInit, 'resetCameraView');

    service.resetCameraView();

    expect(sceneInit.resetCameraView).toHaveBeenCalled();
  });

  it('uses the configured font when creating cake text', fakeAsync(() => {
    const sceneInit = TestBed.inject(SceneInitService);
    (sceneInit as any).scene = new THREE.Scene();
    const mockFont = {} as Font;
    const loadFontSpy = spyOn<any>(service, 'loadFont').and.returnValue(Promise.resolve(mockFont));
    const textFactorySpy = spyOn(TextFactory, 'createTextMesh').and.callFake(() => (
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    ));

    (service as any).options = {
      cake_size: 1,
      cake_color: '#fff000',
      cake_text: true,
      cake_text_value: 'Hi',
      cake_text_position: 'top',
      cake_text_offset: 0,
      cake_text_font: 'optimer',
      layers: 1,
      shape: 'cylinder',
      layerSizes: [1],
    };

    (service as any).loadAndAddText('Hi', 1, 1, 0.1, {
      position: 'top',
      offset: 0,
      font: 'optimer',
    });
    tick();

    expect(loadFontSpy).toHaveBeenCalledWith('optimer');
    expect(textFactorySpy.calls.first()?.args[0]).toBe(mockFont);
  }));

  it('positions text along the cake side with offset', fakeAsync(() => {
    const sceneInit = TestBed.inject(SceneInitService);
    (sceneInit as any).scene = new THREE.Scene();
    spyOn<any>(service, 'loadFont').and.returnValue(Promise.resolve({} as Font));
    spyOn(TextFactory, 'createTextMesh').and.callFake(() => (
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    ));

    const metadata: CakeMetadata = {
      shape: 'cylinder',
      layers: 1,
      layerHeight: 2,
      totalHeight: 2,
      layerSizes: [1],
      layerDimensions: [
        { index: 0, size: 1, height: 2, topY: 1, bottomY: -1, radius: 1 },
      ],
      radius: 1,
    };

    (service as any).cakeMetadata = metadata;
    (service as any).options = {
      cake_size: 1,
      cake_color: '#fff000',
      cake_text: true,
      cake_text_value: 'OK',
      cake_text_position: 'side',
      cake_text_offset: 0.25,
      cake_text_font: 'helvetiker',
      layers: 1,
      shape: 'cylinder',
      layerSizes: [1],
    };

    (service as any).loadAndAddText('OK', 1, 2, 0.1, {
      position: 'side',
      offset: 0.25,
      font: 'helvetiker',
    });
    tick();

    const textMesh = (service as any).textMesh as THREE.Object3D | null;
    expect(textMesh).toBeTruthy();
    if (textMesh) {
      const expectedHeight = (service as any).getCakeTopHeight() / 2;
      const offset = 0.25 * expectedHeight;
      expect(textMesh.position.y).toBeCloseTo(expectedHeight + offset, 3);
    }
  }));
});
