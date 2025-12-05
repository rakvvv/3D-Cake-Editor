import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { By } from '@angular/platform-browser';
import { PaintPanelComponent } from './paint-panel.component';
import { PaintService } from '../../services/paint.service';
import { BehaviorSubject } from 'rxjs';
import { DecorationsService } from '../../services/decorations.service';
import { DecorationInfo } from '../../models/decorationInfo';

describe('PaintPanelComponent', () => {
  let fixture: ComponentFixture<PaintPanelComponent>;
  let component: PaintPanelComponent;
  let paintService: jasmine.SpyObj<PaintService>;
  let decorationsService: Partial<DecorationsService>;
  let decorations$: BehaviorSubject<DecorationInfo[]>;

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

    decorations$ = new BehaviorSubject<DecorationInfo[]>([
      {
        id: 'trawa',
        name: 'Trawa',
        modelFileName: 'trawa.glb',
        type: 'SIDE',
        thumbnailUrl: '/thumb.svg',
        paintable: true,
      },
      {
        id: 'stożek',
        name: 'Stożek',
        modelFileName: 'chocolate_kiss.glb',
        type: 'BOTH',
        paintable: true,
      },
      {
        id: 'nie-pedzel',
        name: 'Nie do pędzla',
        modelFileName: 'not-brush.glb',
        type: 'TOP',
        paintable: false,
      },
    ]);
    decorationsService = {
      decorations$: decorations$.asObservable(),
      getDecorations: () => decorations$.value,
    };

    await TestBed.configureTestingModule({
      imports: [PaintPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PaintPanelComponent);
    component = fixture.componentInstance;
    component.paintService = paintService;
    component.decorationsService = decorationsService as DecorationsService;
    fixture.detectChanges();
  });

  it('pozostawia przełącznik trybu malowania aktywny', () => {
    component.ngOnChanges({
      paintService: new SimpleChange(null, paintService, true),
      decorationsService: new SimpleChange(null, decorationsService, true),
    });
    fixture.detectChanges();

    const toggleButton = fixture.debugElement.query(By.css('.paint-panel__toggle')).nativeElement as HTMLButtonElement;
    expect(toggleButton.disabled).toBeFalse();
  });
});
