import { BehaviorSubject } from 'rxjs';
import { SidebarPaintPanelComponent } from './sidebar-paint-panel.component';
import { CreamPathNode, CreamRingPreset } from '../../../models/cream-presets';
import { SprinkleShape } from '../../../services/surface-painting.service';

type ExtruderPreview = { id: number; name: string; thumbnail: string | null };

class PaintServiceMock {
  creamRingPresets$ = new BehaviorSubject<CreamRingPreset[]>([]);
  extruderPathNodes$ = new BehaviorSubject<CreamPathNode[]>([]);
  setCurrentBrush = jasmine.createSpy('setCurrentBrush');
  setExtruderBrush = jasmine.createSpy('setExtruderBrush');
  setExtruderPathMode = jasmine.createSpy('setExtruderPathMode');
  setExtruderPathContext = jasmine.createSpy('setExtruderPathContext');
  setExtruderPathNodes = jasmine.createSpy('setExtruderPathNodes');
  setExtruderVariantSelection = jasmine.createSpy('setExtruderVariantSelection');
  updatePenSettings = jasmine.createSpy('updatePenSettings');
  async generateExtruderStroke(): Promise<void> {}
  async getExtruderVariantPreviews(): Promise<ExtruderPreview[]> {
    return [];
  }
  getExtruderVariantSelection(): number | 'random' {
    return 'random';
  }
}

class SurfacePaintingServiceMock {
  brushSize = 90;
  sprinkleDensity = 7;
  sprinkleRandomness = 0.3;
  sprinkleColor = '#ffffff';
  sprinkleShape: SprinkleShape = 'stick';
  setEnabled = jasmine.createSpy('setEnabled');
  setSprinkleShape = jasmine.createSpy('setSprinkleShape');
}

describe('SidebarPaintPanelComponent', () => {
  let component: SidebarPaintPanelComponent;
  let paintService: PaintServiceMock;
  let surfacePaintingService: SurfacePaintingServiceMock;

  beforeEach(() => {
    paintService = new PaintServiceMock();
    surfacePaintingService = new SurfacePaintingServiceMock();
    component = new SidebarPaintPanelComponent(paintService as any, surfacePaintingService as any);
    const preset: CreamRingPreset = {
      id: 'path',
      name: 'Path preset',
      mode: 'PATH',
      layerIndex: 0,
      position: 'SIDE_ARC',
      heightNorm: 0.5,
      radiusOffset: 0.01,
      nodes: [
        { angleDeg: 0, heightNorm: 0.5 },
        { angleDeg: 180, heightNorm: 0.5 },
      ],
    };
    paintService.creamRingPresets$.next([preset]);
    component.ngOnInit();
  });

  it('toggles painting power for surface modes', () => {
    component.mode = 'brush';
    component.paintingEnabled = true;

    component.togglePainting();

    expect(component.paintingEnabled).toBeFalse();
    expect(surfacePaintingService.setEnabled).toHaveBeenCalledWith(false);
  });

  it('enables path mode when selecting a path preset', () => {
    component.onExtruderPresetSelect('path');

    expect(component.extruderPathModeEnabled).toBeTrue();
    expect(paintService.setExtruderPathMode).toHaveBeenCalledWith(true);
    expect(paintService.setExtruderPathNodes).toHaveBeenCalled();
  });
});
