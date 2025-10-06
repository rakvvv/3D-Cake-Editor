import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import * as THREE from 'three';

import { ThreeSceneService } from './three-scene.service';
import { TransformControlsService } from './transform-controls-service';
import { SceneInitService } from './scene-init.service';
import { DecorationsService } from './decorations.service';
import { PaintService } from './paint.service';
import { ExportService } from './export.service';
import { SnapService } from './snap.service';

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
        ExportService,
        SnapService,
      ]
    });
    service = TestBed.inject(ThreeSceneService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('removes decoration from tracked objects', () => {
    const sceneInit = TestBed.inject(SceneInitService);
    (sceneInit as any).scene = new THREE.Scene();

    const decoration = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );

    sceneInit.scene.add(decoration);
    service.objects.push(decoration);

    service.removeDecoration(decoration);

    expect(service.objects).not.toContain(decoration);
    expect(sceneInit.scene.children).not.toContain(decoration);
  });
});
