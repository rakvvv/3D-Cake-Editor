import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { CakeSidebarComponent } from './cake-sidebar.component';
import { ThreeSceneService } from '../services/three-scene.service';
import { DecorationsService } from '../services/decorations.service';
import { PaintService } from '../services/paint.service';

describe('CakeSidebarComponent', () => {
  let component: CakeSidebarComponent;
  let fixture: ComponentFixture<CakeSidebarComponent>;

  beforeEach(async () => {
    const threeSceneServiceStub = {
      loadDecorationsData: jasmine.createSpy('loadDecorationsData').and.returnValue(Promise.resolve())
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
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
