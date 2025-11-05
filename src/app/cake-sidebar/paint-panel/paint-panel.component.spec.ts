import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { PaintPanelComponent } from './paint-panel.component';
import { PaintService } from '../../services/paint.service';

describe('PaintPanelComponent', () => {
  let fixture: ComponentFixture<PaintPanelComponent>;
  let component: PaintPanelComponent;
  let paintService: jasmine.SpyObj<PaintService>;

  beforeEach(async () => {
    paintService = jasmine.createSpyObj<PaintService>(
      'PaintService',
      [
        'setPaintTool',
        'setCurrentBrush',
        'updatePenSettings',
        'undo',
        'redo',
        'canUndo',
        'canRedo',
        'getLastNonEraserTool',
        'getSprinkleTextureOptions',
        'isProceduralBrush',
        'getProceduralBrushConfig',
        'updateProceduralBrushSettings',
      ],
      {
        paintMode: false,
        currentBrush: 'trawa.glb',
        paintTool: 'decoration',
        penSize: 0.05,
        penThickness: 0.02,
        penColor: '#ff4d6d',
      },
    );

    paintService.canUndo.and.returnValue(false);
    paintService.canRedo.and.returnValue(false);
    paintService.getSprinkleTextureOptions.and.returnValue([
      { id: 'none', name: 'Bez posypki' },
      { id: 'confetti', name: 'Konfetti' },
      { id: 'cocoa', name: 'Kakao' },
    ]);
    paintService.isProceduralBrush.and.callFake((id: string) => id.startsWith('procedural:'));
    paintService.getProceduralBrushConfig.and.callFake((id: string) => {
      if (id === 'procedural:smear-confetti') {
        return { color: '#ffe8ef', sprinkleTextureId: 'confetti' };
      }
      if (id === 'procedural:smear-cocoa') {
        return { color: '#6b3e2a', sprinkleTextureId: 'cocoa' };
      }
      return { color: '#f6d5c2', sprinkleTextureId: 'none' };
    });

    await TestBed.configureTestingModule({
      imports: [PaintPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PaintPanelComponent);
    component = fixture.componentInstance;
    component.paintService = paintService;
    fixture.detectChanges();
  });

  it('wyłącza przełącznik trybu malowania, gdy aktywna jest gumka', () => {
    paintService.paintTool = 'eraser';
    paintService.getLastNonEraserTool.and.returnValue('pen');

    component.ngOnChanges({ paintService: new SimpleChange(null, paintService, true) });
    fixture.detectChanges();

    const toggleButton = fixture.debugElement.query(By.css('.paint-panel__toggle')).nativeElement as HTMLButtonElement;
    expect(toggleButton.disabled).toBeTrue();
    expect(component.selectedTool).toBe('pen');
  });

  it('aktualizuje ustawienia proceduralnego pędzla przy zmianie koloru', () => {
    component.selectedBrush = 'procedural:smear-vanilla';
    component.ngOnChanges({ paintService: new SimpleChange(null, paintService, true) });
    fixture.detectChanges();

    component.proceduralBrushColors['procedural:smear-vanilla'] = '#ffffff';
    component.onProceduralColorChange();

    expect(paintService.updateProceduralBrushSettings).toHaveBeenCalledWith(
      'procedural:smear-vanilla',
      jasmine.objectContaining({ color: '#ffffff' }),
    );
  });
});
