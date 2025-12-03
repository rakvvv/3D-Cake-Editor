import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TexturesPanelComponent } from './textures-panel.component';
import { CakeOptions } from '../../models/cake.options';

const baseOptions: CakeOptions = {
  cake_size: 1,
  cake_color: '#ffffff',
  cake_text: false,
  cake_text_value: 'Urodziny',
  cake_text_position: 'top',
  cake_text_offset: 0,
  cake_text_font: 'helvetiker',
  cake_text_depth: 0.1,
  layers: 1,
  shape: 'cylinder',
  layerSizes: [1],
  glaze_enabled: true,
  glaze_color: '#ffffff',
  glaze_thickness: 0.1,
  glaze_drip_length: 1.2,
  glaze_seed: 1,
  glaze_top_only: false,
  cake_textures: null,
  glaze_textures: null,
  wafer_texture_url: null,
  wafer_scale: 1,
  wafer_texture_zoom: 1,
  wafer_texture_offset_x: 0,
  wafer_texture_offset_y: 0,
};

describe('TexturesPanelComponent', () => {
  let fixture: ComponentFixture<TexturesPanelComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, TexturesPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TexturesPanelComponent);
    fixture.componentInstance.options = { ...baseOptions };
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('ładuje zestawy tekstur z assets i emituje zmiany', () => {
    fixture.detectChanges();

    const request = httpMock.expectOne('/assets/textures/index.json');
    expect(request.request.method).toBe('GET');
    request.flush({
      sets: [
        {
          id: 'vanilla',
          label: 'Wanilia',
          thumbnail: null,
          cake: { baseColor: '/cake.png' },
          glaze: { baseColor: '/glaze.png' },
        },
      ],
    });

    fixture.detectChanges();

    const placeholder = fixture.debugElement.query(By.css('.texture-card__placeholder'));
    expect(placeholder.nativeElement.textContent.trim()).toBe('Wanilia');

    const buttons = fixture.debugElement.queryAll(By.css('.texture-card__buttons button'));
    expect(buttons.length).toBe(2);

    let emitted: CakeOptions | undefined;
    fixture.componentInstance.cakeOptionsChange.subscribe((value: CakeOptions) => {
      emitted = value;
    });

    buttons[0].nativeElement.click();
    expect(emitted?.cake_textures?.baseColor).toBe('/cake.png');
    expect(emitted?.cake_color).toBe('#ffffff');

    buttons[1].nativeElement.click();
    expect(emitted?.glaze_textures?.baseColor).toBe('/glaze.png');
    expect(emitted?.glaze_color).toBe('#ffffff');
  });
});
