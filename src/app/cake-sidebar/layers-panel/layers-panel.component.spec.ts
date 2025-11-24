import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { LayersPanelComponent } from './layers-panel.component';
import { CakeOptions } from '../../models/cake.options';

describe('LayersPanelComponent', () => {
  let fixture: ComponentFixture<LayersPanelComponent>;
  let component: LayersPanelComponent;
  let createObjectUrlSpy: jasmine.Spy<(file: File) => string>;
  let revokeObjectUrlSpy: jasmine.Spy<(url: string) => void>;

  beforeEach(async () => {
    createObjectUrlSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:preview');
    revokeObjectUrlSpy = spyOn(URL, 'revokeObjectURL').and.callThrough();

    await TestBed.configureTestingModule({
      imports: [LayersPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LayersPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('odrzuca nieobsługiwany format pliku i czyści podgląd', () => {
    component.waferTextureUrl = 'blob:old';
    const emitSpy = spyOn(component.cakeOptionsChange, 'emit');
    const invalidFile = new File(['oops'], 'avatar.txt', { type: 'text/plain' });

    (component as unknown as { processWaferFile(file: File | null): void }).processWaferFile(invalidFile);

    expect(component.waferTextureUrl).toBeNull();
    expect(component.waferError).toContain('Dozwolone');
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:old');
    expect(emitSpy).toHaveBeenCalled();
  });

  it('ustawia miniaturę i emituje opcje dla poprawnego pliku', () => {
    const emitSpy = spyOn(component.cakeOptionsChange, 'emit');
    const validFile = new File(['data'], 'photo.png', { type: 'image/png' });

    (component as unknown as { processWaferFile(file: File | null): void }).processWaferFile(validFile);

    expect(createObjectUrlSpy).toHaveBeenCalledWith(validFile);
    expect(component.waferTextureUrl).toBe('blob:preview');
    expect(component.waferError).toBeNull();

    const emitted = emitSpy.calls.mostRecent()?.args[0] as CakeOptions | undefined;
    expect(emitted?.wafer_texture_url).toBe('blob:preview');
    expect(emitted?.wafer_scale).toBeCloseTo(component.waferScale);
  });

  it('renderuje miniaturę po wyborze pliku w szablonie', () => {
    const fileInput = fixture.debugElement.query(By.css('[data-testid="wafer-upload"]')).nativeElement as HTMLInputElement;
    const file = new File(['bin'], 'logo.png', { type: 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    Object.defineProperty(fileInput, 'files', { value: dataTransfer.files });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const preview = fixture.debugElement.query(By.css('[data-testid="wafer-preview"]')).nativeElement as HTMLImageElement;
    expect(preview.src).toContain('blob:preview');
  });
});
