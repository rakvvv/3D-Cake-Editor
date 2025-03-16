import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CakeSidebarComponent } from './cake-sidebar.component';

describe('CakeSidebarComponent', () => {
  let component: CakeSidebarComponent;
  let fixture: ComponentFixture<CakeSidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CakeSidebarComponent]
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
