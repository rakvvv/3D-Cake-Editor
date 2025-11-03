import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import * as THREE from 'three';

import { CakeEditorComponent } from './cake-editor.component';
import { ThreeSceneService } from '../services/three-scene.service';
import { DecorationsService } from '../services/decorations.service';
import { TransformControlsService } from '../services/transform-controls-service';
import { PaintService } from '../services/paint.service';

type PaintServiceStubType = {
  paintMode: boolean;
  paintTool: 'decoration' | 'pen' | 'eraser';
  lastNonEraserTool: 'decoration' | 'pen';
  setPaintTool: jasmine.Spy;
  getLastNonEraserTool: jasmine.Spy;
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
      detachSelectedDecorationFromCake: jasmine
        .createSpy('detachSelectedDecorationFromCake')
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

    const decorationsServiceStub = jasmine.createSpyObj<DecorationsService>(
      'DecorationsService',
      ['addDecorationFromModel'],
    );

    paintServiceStub = {
      paintMode: false,
      paintTool: 'pen',
      lastNonEraserTool: 'pen',
      setPaintTool: jasmine.createSpy('setPaintTool').and.callFake((tool: 'decoration' | 'pen' | 'eraser') => {
        paintServiceStub.paintTool = tool;
        if (tool !== 'eraser') {
          paintServiceStub.lastNonEraserTool = tool;
        }
      }),
      getLastNonEraserTool: jasmine
        .createSpy('getLastNonEraserTool')
        .and.callFake(() => paintServiceStub.lastNonEraserTool),
    } as PaintServiceStubType;

    await TestBed.configureTestingModule({
      imports: [CakeEditorComponent],
      providers: [
        { provide: ThreeSceneService, useValue: threeSceneServiceStub },
        { provide: TransformControlsService, useValue: transformControlsServiceStub },
        { provide: DecorationsService, useValue: decorationsServiceStub },
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

  it('przełącza globalny tryb gumki i przywraca poprzednie narzędzie', () => {
    const eraserButton = fixture.debugElement.query(By.css('[data-testid="global-eraser-toggle"]'));

    eraserButton.triggerEventHandler('click');
    fixture.detectChanges();

    expect(paintServiceStub.setPaintTool).toHaveBeenCalledWith('eraser');
    expect(paintServiceStub.paintMode).toBeTrue();
    expect(component.isEraserActive).toBeTrue();

    eraserButton.triggerEventHandler('click');
    fixture.detectChanges();

    expect(paintServiceStub.setPaintTool).toHaveBeenCalledWith('pen');
    expect(paintServiceStub.paintMode).toBeFalse();
    expect(component.isEraserActive).toBeFalse();
  });
});
