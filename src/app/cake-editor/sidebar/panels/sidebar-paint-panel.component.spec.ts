import { ChangeDetectorRef } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SidebarPaintPanelComponent } from './sidebar-paint-panel.component';
import { DecorationInfo } from '../../../models/decorationInfo';
import { CreamPathNode, CreamRingPreset } from '../../../models/cream-presets';
import { SprinkleShape } from '../../../services/surface-painting.service';

class DecorationsServiceMock {
  decorationsSubject = new BehaviorSubject<DecorationInfo[]>([]);
  decorations$ = this.decorationsSubject.asObservable();
}

class AnchorPresetsServiceMock {
  pendingDecorationSubject = new BehaviorSubject<DecorationInfo | null>(null);
  pendingDecoration$ = this.pendingDecorationSubject.asObservable();
  setPendingDecoration(): void {}
}

class PaintServiceMock {
  creamRingPresets$ = new BehaviorSubject<CreamRingPreset[]>([]);
  extruderPathNodes$ = new BehaviorSubject<CreamPathNode[]>([]);
  setCurrentBrush = jasmine.createSpy('setCurrentBrush');
  setBrushMetadata = jasmine.createSpy('setBrushMetadata');
  setExtruderPathMode(): void {}
  setExtruderPathContext(): void {}
  setExtruderPathNodes(): void {}
  getExtruderVariantSelection(): number {
    return 0;
  }
  async getExtruderVariantPreviews(): Promise<{ id: number; name: string; thumbnail: string | null }[]> {
    return [];
  }
  async generateExtruderStroke(): Promise<void> {}
}

class SurfacePaintingServiceMock {
  brushSize = 90;
  sprinkleDensity = 7;
  sprinkleRandomness = 0.3;
  sprinkleColor = '#ffffff';
  sprinkleShape: SprinkleShape = 'stick';
  setEnabled(): void {}
  setSprinkleShape(): void {}
  setExtruderPathMode(): void {}
  setExtruderPathContext(): void {}
}

describe('SidebarPaintPanelComponent', () => {
  let component: SidebarPaintPanelComponent;
  let decorationsService: DecorationsServiceMock;
  let paintService: PaintServiceMock;
  let cdrMock: ChangeDetectorRef;

  beforeEach(() => {
    decorationsService = new DecorationsServiceMock();
    paintService = new PaintServiceMock();
    cdrMock = {
      markForCheck: jasmine.createSpy('markForCheck'),
      detectChanges: jasmine.createSpy('detectChanges'),
      detach: jasmine.createSpy('detach'),
      reattach: jasmine.createSpy('reattach'),
      checkNoChanges: jasmine.createSpy('checkNoChanges'),
    } as unknown as ChangeDetectorRef;
    component = new SidebarPaintPanelComponent(
      decorationsService as any,
      new AnchorPresetsServiceMock() as any,
      paintService as any,
      new SurfacePaintingServiceMock() as any,
      cdrMock,
    );
    component.ngOnInit();
  });

  it('filters out non-paintable decorations in decor painting mode', () => {
    const paintableDecoration: DecorationInfo = {
      id: 'paintable',
      modelFileName: 'paintable.glb',
      name: 'Paintable',
      type: 'TOP',
      paintable: true,
      paintInitialRotation: [10, 20, 30],
    };
    const nonPaintableDecoration: DecorationInfo = {
      id: 'non-paintable',
      modelFileName: 'non-paintable.glb',
      name: 'Non Paintable',
      type: 'TOP',
      paintable: false,
    };

    decorationsService.decorationsSubject.next([paintableDecoration, nonPaintableDecoration]);

    expect(component.filteredDecorations).toEqual([paintableDecoration]);
    expect(paintService.setBrushMetadata).toHaveBeenCalledTimes(1);
    expect(paintService.setBrushMetadata).toHaveBeenCalledWith('paintable.glb', {
      initialScale: undefined,
      initialRotation: [10, 20, 30],
      material: undefined,
      paintInitialRotation: [10, 20, 30],
      surfaceOffset: undefined,
      modelUpAxis: undefined,
      modelForwardAxis: undefined,
      faceOutwardOnSides: undefined,
    });
  });

  it('applies painting-specific rotation when provided', () => {
    const paintableDecoration: DecorationInfo = {
      id: 'paintable-rotation',
      modelFileName: 'paintable-rotation.glb',
      name: 'Paintable Rotation',
      type: 'TOP',
      paintable: true,
      paintInitialRotation: [0, 90, 45],
      initialRotation: [1, 2, 3],
    };

    decorationsService.decorationsSubject.next([paintableDecoration]);

    expect(component.filteredDecorations).toEqual([paintableDecoration]);
    expect(paintService.setBrushMetadata).toHaveBeenCalledWith('paintable-rotation.glb', {
      initialScale: undefined,
      initialRotation: [0, 90, 45],
      material: undefined,
      paintInitialRotation: [0, 90, 45],
      surfaceOffset: undefined,
      modelUpAxis: undefined,
      modelForwardAxis: undefined,
      faceOutwardOnSides: undefined,
    });
  });
});
