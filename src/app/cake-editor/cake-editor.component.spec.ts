import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CakeEditorComponent } from './cake-editor.component';

describe('CakeEditorComponent', () => {
  let component: CakeEditorComponent;
  let fixture: ComponentFixture<CakeEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CakeEditorComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CakeEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
