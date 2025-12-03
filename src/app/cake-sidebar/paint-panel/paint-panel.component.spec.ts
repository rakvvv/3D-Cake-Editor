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
        'setExtruderVariantSelection',
        'getExtruderVariantPreviews',
        'insertExtruderPreset',
        'undo',
        'redo',
        'canUndo',
        'canRedo',
        'getExtruderVariantSelection',
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
    paintService.getExtruderVariantSelection.and.returnValue('random');
    paintService.getExtruderVariantPreviews.and.resolveTo([]);
    paintService.insertExtruderPreset.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [PaintPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PaintPanelComponent);
    component = fixture.componentInstance;
    component.paintService = paintService;
    fixture.detectChanges();
  });

  it('pozostawia przełącznik trybu malowania aktywny', () => {
    component.ngOnChanges({ paintService: new SimpleChange(null, paintService, true) });
    fixture.detectChanges();

    const toggleButton = fixture.debugElement.query(By.css('.paint-panel__toggle')).nativeElement as HTMLButtonElement;
    expect(toggleButton.disabled).toBeFalse();
  });
});
