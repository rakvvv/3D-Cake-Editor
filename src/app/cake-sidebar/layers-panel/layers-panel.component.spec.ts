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
    expect(component.waferTextureZoom).toBe(1);
    expect(component.waferTextureOffsetX).toBe(0);
    expect(component.waferTextureOffsetY).toBe(0);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:old');
    expect(emitSpy).toHaveBeenCalled();
  });

  it('ustawia miniaturę, zeruje przesunięcia i emituje opcje dla poprawnego pliku', () => {
    const emitSpy = spyOn(component.cakeOptionsChange, 'emit');
    const validFile = new File(['data'], 'photo.png', { type: 'image/png' });

    (component as unknown as { processWaferFile(file: File | null): void }).processWaferFile(validFile);

    expect(createObjectUrlSpy).toHaveBeenCalledWith(validFile);
    expect(component.waferTextureUrl).toBe('blob:preview');
    expect(component.waferError).toBeNull();
    expect(component.waferEditorOpen).toBeTrue();
    expect(component.waferTextureZoom).toBe(1);
    expect(component.waferTextureOffsetX).toBe(0);
    expect(component.waferTextureOffsetY).toBe(0);

    const emitted = emitSpy.calls.mostRecent()?.args[0] as CakeOptions | undefined;
    expect(emitted?.wafer_texture_url).toBe('blob:preview');
    expect(emitted?.wafer_scale).toBeCloseTo(component.waferScale);
    expect(emitted?.wafer_texture_zoom).toBe(1);
    expect(emitted?.wafer_texture_offset_x).toBe(0);
    expect(emitted?.wafer_texture_offset_y).toBe(0);
  });

  it('renderuje podgląd w trybie okna i pozwala go otworzyć z przycisku', () => {
    const fileInput = fixture.debugElement.query(By.css('[data-testid="wafer-upload"]')).nativeElement as HTMLInputElement;
    const file = new File(['bin'], 'logo.png', { type: 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    Object.defineProperty(fileInput, 'files', { value: dataTransfer.files });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const openButton = fixture.debugElement.query(By.css('[data-testid="wafer-open-editor"]')).nativeElement as HTMLButtonElement;
    expect(openButton).toBeTruthy();

    openButton.click();
    fixture.detectChanges();

    const modal = fixture.debugElement.query(By.css('[data-testid="wafer-editor"]'));
    expect(modal).toBeTruthy();
  });
});
