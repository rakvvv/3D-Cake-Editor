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
import { AnchorPresetsService } from './anchor-presets.service';
import { AnchorPoint } from '../models/anchors';

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
  const assignScene = (sceneInit: SceneInitService) =>
    Object.defineProperty(sceneInit, 'scene', { value: new THREE.Scene(), writable: true });

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
    assignScene(sceneInit);

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
    assignScene(sceneInit);

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
    assignScene(sceneInit);
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
      cake_text_depth: 0.1,
      layers: 1,
      shape: 'cylinder',
      layerSizes: [1],
      glaze_enabled: true,
      glaze_color: '#ffffff',
      glaze_thickness: 0.1,
      glaze_drip_length: 1,
      glaze_seed: 1,
      glaze_top_enabled: true,
      cake_textures: null,
      glaze_textures: null,
      wafer_texture_url: null,
      wafer_scale: 1,
      wafer_texture_zoom: 1,
      wafer_texture_offset_x: 0,
      wafer_texture_offset_y: 0,
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

  it('keeps existing anchor occupants when moving a decoration between anchors', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    assignScene(sceneInit);
    const anchorPresets = TestBed.inject(AnchorPresetsService);
    const snapService = TestBed.inject(SnapService);

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

    const cakeBase = new THREE.Group();
    cakeBase.userData['metadata'] = metadata;
    snapService.setCakeBase(cakeBase);
    (service as any).cakeBase = cakeBase;
    (service as any).cakeMetadata = metadata;
    sceneInit.scene.add(cakeBase);

    const anchors: AnchorPoint[] = [
      { id: 'top', surface: 'TOP', layerIndex: 0, coordinates: { angleRad: 0 } },
      { id: 'side', surface: 'SIDE', layerIndex: 0, coordinates: { angleRad: Math.PI / 2 } },
    ];

    anchorPresets.setPresets([{ id: 'test', name: 'Test preset', anchors }]);

    const existingOccupant = new THREE.Object3D();
    (service as any).applyAnchorPlacement(existingOccupant, anchors[1]);

    const movedDecoration = new THREE.Object3D();
    (service as any).applyAnchorPlacement(movedDecoration, anchors[0]);

    const transformStub = TestBed.inject(TransformControlsService) as unknown as TransformControlsServiceStub;
    transformStub.setSelectedObject(movedDecoration);

    const result = service.moveSelectionToAnchor('side');

    expect(result.success).toBeTrue();
    const anchorOccupants = (service as any).getAnchorOccupants('side');
    expect(anchorOccupants).toContain(existingOccupant);
    expect(anchorOccupants).toContain(movedDecoration);
    expect(cakeBase.children).toContain(existingOccupant);
  });

  it('replaces anchor occupants when requested', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    assignScene(sceneInit);
    const anchorPresets = TestBed.inject(AnchorPresetsService);
    const snapService = TestBed.inject(SnapService);

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

    const cakeBase = new THREE.Group();
    cakeBase.userData['metadata'] = metadata;
    snapService.setCakeBase(cakeBase);
    (service as any).cakeBase = cakeBase;
    (service as any).cakeMetadata = metadata;
    sceneInit.scene.add(cakeBase);

    const anchors: AnchorPoint[] = [
      { id: 'single', surface: 'TOP', layerIndex: 0, coordinates: { angleRad: 0 } },
    ];

    anchorPresets.setPresets([{ id: 'test', name: 'Test preset', anchors }]);

    const initialOccupant = new THREE.Object3D();
    (service as any).applyAnchorPlacement(initialOccupant, anchors[0]);

    const replacement = new THREE.Object3D();
    (service as any).applyAnchorPlacement(replacement, anchors[0], undefined, { replaceExisting: true });

    const anchorOccupants = (service as any).getAnchorOccupants('single');
    expect(anchorOccupants).toContain(replacement);
    expect(anchorOccupants).not.toContain(initialOccupant);
    expect(cakeBase.children).toContain(replacement);
    expect(cakeBase.children).not.toContain(initialOccupant);
  });

  it('preserves occupants on anchors while recording options', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    assignScene(sceneInit);
    const anchorPresets = TestBed.inject(AnchorPresetsService);
    const snapService = TestBed.inject(SnapService);

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

    const cakeBase = new THREE.Group();
    cakeBase.userData['metadata'] = metadata;
    snapService.setCakeBase(cakeBase);
    (service as any).cakeBase = cakeBase;
    (service as any).cakeMetadata = metadata;
    sceneInit.scene.add(cakeBase);

    const anchors: AnchorPoint[] = [
      { id: 'recorded', surface: 'TOP', layerIndex: 0, coordinates: { angleRad: 0 } },
      { id: 'other', surface: 'TOP', layerIndex: 0, coordinates: { angleRad: Math.PI } },
    ];

    anchorPresets.setPresets([{ id: 'recording', name: 'Recording preset', anchors }]);
    anchorPresets.setRecordingOptions(true);

    const existingOccupant = new THREE.Object3D();
    (service as any).applyAnchorPlacement(existingOccupant, anchors[0]);

    const incomingDecoration = new THREE.Object3D();
    (service as any).applyAnchorPlacement(incomingDecoration, anchors[1]);

    const transformStub = TestBed.inject(TransformControlsService) as unknown as TransformControlsServiceStub;
    transformStub.setSelectedObject(incomingDecoration);

    const result = service.moveSelectionToAnchor('recorded');

    expect(result.success).toBeTrue();
    const anchorOccupants = (service as any).getAnchorOccupants('recorded');
    expect(anchorOccupants).toContain(existingOccupant);
    expect(anchorOccupants).toContain(incomingDecoration);
  });

  it('keeps unused anchors when overwriting the active preset', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    assignScene(sceneInit);
    const anchorPresets = TestBed.inject(AnchorPresetsService);
    const snapService = TestBed.inject(SnapService);

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

    const cakeBase = new THREE.Group();
    cakeBase.userData['metadata'] = metadata;
    snapService.setCakeBase(cakeBase);
    (service as any).cakeBase = cakeBase;
    (service as any).cakeMetadata = metadata;
    sceneInit.scene.add(cakeBase);

    const anchors: AnchorPoint[] = [
      {
        id: 'kept',
        surface: 'TOP',
        layerIndex: 0,
        coordinates: { angleRad: 0 },
        allowedDecorationIds: ['keep-me'],
      },
      { id: 'moved', surface: 'SIDE', layerIndex: 0, coordinates: { angleRad: Math.PI / 2 } },
    ];

    anchorPresets.setPresets([{ id: 'active', name: 'Active preset', anchors }]);

    const decoration = new THREE.Object3D();
    decoration.name = 'flower';
    (service as any).applyAnchorPlacement(decoration, anchors[1]);

    const exported = service.exportAllAnchors();

    expect(exported).not.toBeNull();
    expect(exported?.anchors.length).toBe(2);
    const keptAnchor = exported?.anchors.find((anchor) => anchor.id === 'kept');
    expect(keptAnchor).toBeTruthy();
    expect(keptAnchor?.allowedDecorationIds).toContain('keep-me');
  });

  it('builds a fresh preset from the scene when not preserving unused anchors', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    assignScene(sceneInit);
    const anchorPresets = TestBed.inject(AnchorPresetsService);
    const snapService = TestBed.inject(SnapService);

    const metadata: CakeMetadata = {
      shape: 'cylinder',
      layers: 2,
      layerHeight: 1.5,
      totalHeight: 3,
      layerSizes: [1, 0.8],
      layerDimensions: [
        { index: 0, size: 1, height: 1.5, topY: 0.75, bottomY: -0.75, radius: 1 },
        { index: 1, size: 0.8, height: 1.5, topY: 2.25, bottomY: 0.75, radius: 0.8 },
      ],
      radius: 1,
    };

    const cakeBase = new THREE.Group();
    cakeBase.userData['metadata'] = metadata;
    snapService.setCakeBase(cakeBase);
    (service as any).cakeBase = cakeBase;
    (service as any).cakeMetadata = metadata;
    sceneInit.scene.add(cakeBase);

    anchorPresets.setPresets([
      {
        id: 'active',
        name: 'Active preset',
        anchors: [{ id: 'old', surface: 'TOP', layerIndex: 0, coordinates: { angleRad: 0 } }],
      },
    ]);

    const decoration = new THREE.Object3D();
    decoration.name = 'candle';
    (service as any).applyAnchorPlacement(decoration, {
      id: 'fresh',
      surface: 'SIDE',
      layerIndex: 1,
      coordinates: { angleRad: Math.PI / 3 },
    });

    const exported = service.exportAllAnchors({ preserveUnusedFromActive: false });

    expect(exported).not.toBeNull();
    expect(exported?.anchors.length).toBe(1);
    expect(exported?.anchors[0].id).toBe('fresh');
    expect(exported?.cakeShape).toBe('cylinder');
    expect(exported?.tiers).toBe(2);
    expect(exported?.cakeSize).toBe('medium');
  });

  it('positions text along the cake side with offset', fakeAsync(() => {
    const sceneInit = TestBed.inject(SceneInitService);
    (sceneInit as any).scene = new THREE.Scene();
    spyOn<any>(service, 'loadFont').and.returnValue(Promise.resolve({} as Font));
    const textFactorySpy = spyOn(TextFactory, 'createTextMesh').and.callFake(() => (
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
      cake_text_depth: 0.1,
      layers: 1,
      shape: 'cylinder',
      layerSizes: [1],
      glaze_enabled: true,
      glaze_color: '#ffffff',
      glaze_thickness: 0.1,
      glaze_drip_length: 1,
      glaze_seed: 1,
      glaze_top_enabled: true,
      cake_textures: null,
      glaze_textures: null,
      wafer_texture_url: null,
      wafer_scale: 1,
      wafer_texture_zoom: 1,
      wafer_texture_offset_x: 0,
      wafer_texture_offset_y: 0,
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

  it('orients side text outwards and keeps it close to the cake surface', fakeAsync(() => {
    const sceneInit = TestBed.inject(SceneInitService);
    (sceneInit as any).scene = new THREE.Scene();
    spyOn<any>(service, 'loadFont').and.returnValue(Promise.resolve({} as Font));
    const textFactorySpy = spyOn(TextFactory, 'createTextMesh').and.callFake(() => (
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
      cake_text_value: 'A',
      cake_text_position: 'side',
      cake_text_offset: 0,
      cake_text_font: 'helvetiker',
      cake_text_depth: 0.1,
      layers: 1,
      shape: 'cylinder',
      layerSizes: [1],
      glaze_enabled: true,
      glaze_color: '#ffffff',
      glaze_thickness: 0.1,
      glaze_drip_length: 1,
      glaze_seed: 1,
      glaze_top_enabled: true,
      cake_textures: null,
      glaze_textures: null,
      wafer_texture_url: null,
      wafer_scale: 1,
      wafer_texture_zoom: 1,
      wafer_texture_offset_x: 0,
      wafer_texture_offset_y: 0,
    };

    (service as any).loadAndAddText('A', 1, 2, 0.1, {
      position: 'side',
      offset: 0,
      font: 'helvetiker',
    });
    tick();

    const textMesh = (service as any).textMesh as THREE.Group | null;
    expect(textMesh).toBeTruthy();
    if (!textMesh) {
      return;
    }

    const letterMesh = textMesh.children.find((child) => (child as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    expect(letterMesh).toBeDefined();
    if (!letterMesh) {
      return;
    }

    const distance = Math.sqrt(letterMesh.position.x ** 2 + letterMesh.position.z ** 2);
    const expectedDistance = Math.max(1 + 0.1 / 2 - 0.01, 0.2);
    expect(letterMesh.rotation.y).toBeCloseTo(0, 3);
    expect(distance).toBeCloseTo(expectedDistance, 3);
    expect(textFactorySpy.calls.first()?.args[2].verticalAlign).toBe('baseline');
  }));

  it('lays the top text flat on the cake surface', fakeAsync(() => {
    const sceneInit = TestBed.inject(SceneInitService);
    (sceneInit as any).scene = new THREE.Scene();
    spyOn<any>(service, 'loadFont').and.returnValue(Promise.resolve({} as Font));
    const textFactorySpy = spyOn(TextFactory, 'createTextMesh').and.callFake(() => (
      new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    ));

    (service as any).options = {
      cake_size: 1,
      cake_color: '#fff000',
      cake_text: true,
      cake_text_value: 'TOP',
      cake_text_position: 'top',
      cake_text_offset: 0,
      cake_text_font: 'helvetiker',
      cake_text_depth: 0.1,
      layers: 1,
      shape: 'cylinder',
      layerSizes: [1],
      glaze_enabled: true,
      glaze_color: '#ffffff',
      glaze_thickness: 0.1,
      glaze_drip_length: 1,
      glaze_seed: 1,
      glaze_top_enabled: true,
      cake_textures: null,
      glaze_textures: null,
      wafer_texture_url: null,
      wafer_scale: 1,
      wafer_texture_zoom: 1,
      wafer_texture_offset_x: 0,
      wafer_texture_offset_y: 0,
    };

    (service as any).loadAndAddText('TOP', 1, 2, 0.1, {
      position: 'top',
      offset: 0,
      font: 'helvetiker',
    });
    tick();

    const textMesh = (service as any).textMesh as THREE.Group | null;
    expect(textMesh).toBeTruthy();
    if (!textMesh) {
      return;
    }

    expect(textFactorySpy).toHaveBeenCalledTimes(1);
    expect(textMesh.children.length).toBe(1);
    expect(textMesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    expect(textMesh.position.y).toBeCloseTo(2 + 0.1 / 2 + 0.001, 5);
  }));

  it('uses glyph advance metrics to space curved text evenly', () => {
    const material = new THREE.MeshBasicMaterial();
    spyOn(TextFactory, 'createTextMesh').and.callFake(() => (
      new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.1), material)
    ));

    const font = {
      data: {
        glyphs: {
          A: { ha: 200 },
          B: { ha: 800 },
        },
        resolution: 1000,
      }
    } as unknown as Font;

    const radius = 2;
    const group = (service as any).createCurvedTextGroup(font, 'AB', 1, 0.1, radius, material);

    const meshes = group.children as THREE.Mesh[];
    expect(meshes.length).toBe(2);
    const [first, second] = meshes;
    const firstAngle = Math.atan2(first.position.x, first.position.z);
    const secondAngle = Math.atan2(second.position.x, second.position.z);
    const actualArc = Math.abs(secondAngle - firstAngle) * radius;
    const expectedSpacing = 0.1 + 0.1 + 0.4; // half of first glyph + spacing + half of second glyph
    expect(actualArc).toBeCloseTo(expectedSpacing, 2);
  });

  it('keeps baseline descenders below the alignment line on curved text', () => {
    const material = new THREE.MeshBasicMaterial();
    spyOn(TextFactory, 'createTextMesh').and.callFake(() => {
      const geometry = new THREE.BoxGeometry(0.4, 0.6, 0.1);
      geometry.translate(0, -0.2, 0);
      const mesh = new THREE.Mesh(geometry, material);
      return mesh;
    });

    const font = {
      data: {
        glyphs: {
          y: { ha: 300 },
        },
        resolution: 1000,
      }
    } as unknown as Font;

    const group = (service as any).createCurvedTextGroup(font, 'y', 1, 0.1, 1, material);
    const mesh = group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.min.y ?? 0).toBeLessThan(0);
  });
});
