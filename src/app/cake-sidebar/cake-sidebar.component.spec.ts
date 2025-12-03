import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { CakeSidebarComponent } from './cake-sidebar.component';
import { ThreeSceneService } from '../services/three-scene.service';
import { DecorationsService } from '../services/decorations.service';
import { PaintService } from '../services/paint.service';
import { CakeOptions } from '../models/cake.options';

describe('CakeSidebarComponent', () => {
  let component: CakeSidebarComponent;
  let fixture: ComponentFixture<CakeSidebarComponent>;

  const baseOptions: CakeOptions = {
    cake_size: 1,
    cake_color: '#ffffff',
    cake_text: false,
    cake_text_value: 'Test',
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

  beforeEach(async () => {
    const threeSceneServiceStub = {
      loadDecorationsData: jasmine.createSpy('loadDecorationsData').and.returnValue(Promise.resolve()),
      getSceneOutline: jasmine.createSpy('getSceneOutline').and.returnValue({
        id: 'cake-root',
        name: 'Tort',
        type: 'cake',
        attached: true,
        visible: true,
        parentId: null,
        layerIndex: null,
        surface: null,
        children: [],
      }),
      getSelectedDecorationId: jasmine.createSpy('getSelectedDecorationId').and.returnValue(null),
      selectDecorationById: jasmine.createSpy('selectDecorationById'),
      setDecorationVisibility: jasmine.createSpy('setDecorationVisibility'),
      groupDecorationsByIds: jasmine.createSpy('groupDecorationsByIds'),
    } as Partial<ThreeSceneService>;

    const decorationsServiceStub = {
      decorations$: of([]),
      getDecorations: () => [],
      setDecorations: jasmine.createSpy('setDecorations')
    } as Partial<DecorationsService>;

    const paintServiceStub = {} as Partial<PaintService>;

    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, CakeSidebarComponent],
      providers: [
        { provide: ThreeSceneService, useValue: threeSceneServiceStub },
        { provide: DecorationsService, useValue: decorationsServiceStub },
        { provide: PaintService, useValue: paintServiceStub }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CakeSidebarComponent);
    component = fixture.componentInstance;
    component.options = baseOptions;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
