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

  it('nie emituje zmian w trakcie dopasowywania, dopiero po zapisie', () => {
    component.waferTextureUrl = 'blob:preview';
    component.waferTextureZoom = 1.2;
    component.waferTextureOffsetX = 0.1;
    component.waferTextureOffsetY = -0.1;
    component.openWaferEditor();

    const emitSpy = spyOn(component.cakeOptionsChange, 'emit');
    const viewport = document.createElement('div');
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, width: 200, height: 200, top: 0, left: 0, right: 200, bottom: 200 }),
    });
    (viewport as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    (viewport as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
    component.waferViewport = new (class {
      nativeElement = viewport;
    })() as unknown as typeof component.waferViewport;

    component.onWaferZoomChanged(2);
    component.onWaferPointerDown(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 1 }));
    component.onWaferPointerMove(new PointerEvent('pointermove', { clientX: 100, clientY: 100, pointerId: 1 }));
    component.onWaferPointerUp(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1 }));

    expect(emitSpy).not.toHaveBeenCalled();

    component.confirmWaferEditor();
    expect(emitSpy).toHaveBeenCalledTimes(1);
    const options = emitSpy.calls.mostRecent()?.args[0] as CakeOptions;
    expect(options.wafer_texture_zoom).toBeCloseTo(2);
  });

  it('przywraca poprzednie wartości po anulowaniu edycji', () => {
    component.waferTextureUrl = 'blob:preview';
    component.waferTextureZoom = 1.1;
    component.waferTextureOffsetX = 0.05;
    component.waferTextureOffsetY = -0.05;
    component.openWaferEditor();

    component.onWaferZoomChanged(3);
    component.onWaferPointerDown(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, pointerId: 2 }));
    component.onWaferPointerMove(new PointerEvent('pointermove', { clientX: 50, clientY: -50, pointerId: 2 }));

    component.closeWaferEditor();

    expect(component.waferTextureZoom).toBeCloseTo(1.1);
    expect(component.waferTextureOffsetX).toBeCloseTo(0.05);
    expect(component.waferTextureOffsetY).toBeCloseTo(-0.05);
  });

  it('odwraca oś Y w podglądzie tak jak na materiale 3D', () => {
    component.waferTextureUrl = 'blob:preview';
    component.waferTextureZoom = 2;
    component.waferTextureOffsetX = 0.1;
    component.waferTextureOffsetY = -0.2;

    const style = component.waferPreviewStyle;
    expect(style['backgroundSize']).toBe('200% 200%');
    expect(style['backgroundPosition']).toBe('60% 30%');
  });

  it('przycina przesunięcie przy zmniejszaniu zoomu, aby uniknąć rozciągania krawędzi', () => {
    component.waferTextureUrl = 'blob:preview';
    component.waferTextureZoom = 2;
    component.waferTextureOffsetX = 0.4;
    component.waferTextureOffsetY = -0.4;

    component.onWaferZoomChanged(1);

    expect(component.waferTextureOffsetX).toBeCloseTo(0);
    expect(component.waferTextureOffsetY).toBeCloseTo(0);
  });
});
