import { ComponentFixture, TestBed } from '@angular/core/testing';
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

    await TestBed.configureTestingModule({
      imports: [PaintPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PaintPanelComponent);
    component = fixture.componentInstance;
    component.paintService = paintService;
    fixture.detectChanges();
  });

  it('przełącza tryb gumki i wywołuje aktualizację usługi malowania', () => {
    const eraserButton = fixture.debugElement.query(By.css('[data-testid="eraser-toggle"]'));

    eraserButton.triggerEventHandler('click');
    fixture.detectChanges();

    expect(component.eraserMode).toBeTrue();
    expect(paintService.setPaintTool).toHaveBeenCalledWith('eraser');

    eraserButton.triggerEventHandler('click');
    fixture.detectChanges();

    expect(component.eraserMode).toBeFalse();
    expect(paintService.setPaintTool).toHaveBeenCalledWith('decoration');
  });
});
