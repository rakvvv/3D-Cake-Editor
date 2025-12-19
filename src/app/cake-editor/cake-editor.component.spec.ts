import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import * as THREE from 'three';
import { BehaviorSubject, of } from 'rxjs';

import { CakeEditorComponent } from './cake-editor.component';
import { ThreeSceneService } from '../services/three-scene.service';
import { DecorationsService } from '../services/decorations.service';
import { TransformControlsService } from '../services/transform-controls-service';
import { PaintService } from '../services/paint.service';
import { CakePresetsService } from '../services/cake-presets.service';
import { DecoratedCakePreset } from '../models/cake-preset';
import { DecorationInfo } from '../models/decorationInfo';
import { TexturesService } from '../services/textures.service';
import { TextureSet } from '../models/texture-set';

type PaintServiceStubType = {
  paintMode: boolean;
  paintTool: 'decoration' | 'pen' | 'extruder';
  setPaintTool: jasmine.Spy;
} & Partial<PaintService>;

describe('CakeEditorComponent', () => {
  let fixture: ComponentFixture<CakeEditorComponent>;
  let component: CakeEditorComponent;

  let paintServiceStub: PaintServiceStubType;

  beforeEach(async () => {
    const threeSceneServiceStub = {
      scene: new THREE.Scene(),
      cakeBase: new THREE.Group(),
      objects: [] as THREE.Object3D[],
      init: jasmine.createSpy('init'),
      updateCakeOptions: jasmine.createSpy('updateCakeOptions'),
      validateDecorations: jasmine.createSpy('validateDecorations').and.returnValue([]),
      buildValidationSummary: jasmine
        .createSpy('buildValidationSummary')
        .and.returnValue(null),
      snapSelectedDecorationToCake: jasmine
        .createSpy('snapSelectedDecorationToCake')
        .and.returnValue({ message: '' }),
      alignSelectedDecorationToSurface: jasmine
        .createSpy('alignSelectedDecorationToSurface')
        .and.returnValue({ message: '' }),
      rotateSelectedDecorationQuarter: jasmine
        .createSpy('rotateSelectedDecorationQuarter')
        .and.returnValue({ message: '' }),
      rotateSelectedDecorationHalf: jasmine
        .createSpy('rotateSelectedDecorationHalf')
        .and.returnValue({ message: '' }),
      rotateSelectedDecorationByDegrees: jasmine
        .createSpy('rotateSelectedDecorationByDegrees')
        .and.returnValue({ message: '' }),
      deleteSelectedDecoration: jasmine
        .createSpy('deleteSelectedDecoration')
        .and.returnValue({ message: '' }),
      copySelectedDecoration: jasmine
        .createSpy('copySelectedDecoration')
        .and.returnValue({ message: '' }),
      pasteDecoration: jasmine
        .createSpy('pasteDecoration')
        .and.returnValue({ message: '' }),
      resetSelectedDecorationOrientation: jasmine
        .createSpy('resetSelectedDecorationOrientation')
        .and.returnValue({ message: '' }),
      deselectDecoration: jasmine.createSpy('deselectDecoration').and.returnValue(true),
      resetCameraView: jasmine.createSpy('resetCameraView'),
      takeScreenshot: jasmine.createSpy('takeScreenshot').and.returnValue('data:image/png;base64,'),
      exportOBJ: jasmine.createSpy('exportOBJ').and.returnValue(''),
      exportSTL: jasmine.createSpy('exportSTL').and.returnValue(''),
      exportGLTF: jasmine
        .createSpy('exportGLTF')
        .and.callFake((callback: (gltf: unknown) => void) => callback({})),
      loadDecorationsData: jasmine.createSpy('loadDecorationsData').and.resolveTo(),
      hasCopiedDecoration: jasmine.createSpy('hasCopiedDecoration').and.returnValue(false),
      isOrbitBusy: jasmine.createSpy('isOrbitBusy').and.returnValue(false),
      selectDecorationAt: jasmine.createSpy('selectDecorationAt'),
      getSelectedDecoration: jasmine.createSpy('getSelectedDecoration').and.returnValue(null),
      isSelectedDecorationSnapped: jasmine
        .createSpy('isSelectedDecorationSnapped')
        .and.returnValue(false),
    } satisfies Partial<ThreeSceneService>;

    const transformControlsServiceStub = jasmine.createSpyObj<TransformControlsService>(
      'TransformControlsService',
      ['setTransformMode'],
    );

    const decorationsSubject = new BehaviorSubject<DecorationInfo[]>([]);
    const decorationsServiceStub = {
      addDecorationFromModel: jasmine.createSpy('addDecorationFromModel'),
      decorations$: decorationsSubject.asObservable(),
      setDecorations: jasmine
        .createSpy('setDecorations')
        .and.callFake((decorations: DecorationInfo[]) => decorationsSubject.next(decorations)),
    } as Partial<DecorationsService>;

    const presetsSubject = new BehaviorSubject<DecoratedCakePreset[]>([]);
    const cakePresetsServiceStub = {
      loadPresets: jasmine.createSpy('loadPresets').and.resolveTo(),
      presets$: presetsSubject.asObservable(),
    } as Partial<CakePresetsService>;

    const textureSets: TextureSet[] = [
      {
        id: 'test-texture',
        label: 'Test Texture',
        thumbnailUrl: '/assets/textures/test.jpg',
        cake: {
          baseColor: '/assets/textures/test.jpg',
          repeat: 2,
        },
        glaze: {
          baseColor: '/assets/textures/test-glaze.jpg',
          affectDrips: true,
          repeat: 1,
        },
      },
    ];

    const texturesServiceStub = {
      loadTextureSets: jasmine.createSpy('loadTextureSets').and.returnValue(of(textureSets)),
      sets$: of(textureSets),
    } as Partial<TexturesService>;

    paintServiceStub = {
      paintMode: false,
      paintTool: 'pen',
      setPaintTool: jasmine
        .createSpy('setPaintTool')
        .and.callFake((tool: 'decoration' | 'pen' | 'extruder') => {
          paintServiceStub.paintTool = tool;
        }),
    } as PaintServiceStubType;

    await TestBed.configureTestingModule({
      imports: [CakeEditorComponent],
      providers: [
        { provide: ThreeSceneService, useValue: threeSceneServiceStub },
        { provide: TransformControlsService, useValue: transformControlsServiceStub },
        { provide: DecorationsService, useValue: decorationsServiceStub },
        { provide: CakePresetsService, useValue: cakePresetsServiceStub },
        { provide: TexturesService, useValue: texturesServiceStub },
        { provide: PaintService, useValue: paintServiceStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(CakeEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('tworzy komponent', () => {
    expect(component).toBeTruthy();
  });
});
