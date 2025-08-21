import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { ThreeSceneService } from './three-scene.service';
import { TransformControlsService } from './transform-controls-service';
import { SceneInitService } from './scene-init.service';
import { DecorationsService } from './decorations.service';
import { PaintService } from './paint.service';
import { ExportService } from './export.service';

describe('ThreeSceneService', () => {
  let service: ThreeSceneService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ThreeSceneService,
        TransformControlsService,
        SceneInitService,
        DecorationsService,
        PaintService,
        ExportService
      ]
    });
    service = TestBed.inject(ThreeSceneService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
