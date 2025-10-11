import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { PaintService } from './paint.service';
import { DecorationFactory } from '../factories/decoration.factory';

if (typeof performance === 'undefined') {
  (globalThis as any).performance = {
    now: () => Date.now(),
  } as Performance;
}

const globalPerf: Performance = (globalThis as any).performance;

describe('PaintService', () => {
  let service: PaintService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PaintService],
    });
    service = TestBed.inject(PaintService);
  });

  it('caches brush models and clones new instances', async () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    const template = new THREE.Group();
    template.add(mesh);
    template.userData['clickableMeshes'] = [mesh];

    const loadSpy = spyOn(DecorationFactory, 'loadDecorationModel').and.returnValue(Promise.resolve(template));

    const firstInstance = await (service as any).getBrushInstance('brush.glb');
    const secondInstance = await (service as any).getBrushInstance('brush.glb');

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(firstInstance).not.toBe(secondInstance);
  });

  it('skips dense pen updates while tracking continuous strokes', async () => {
    service.paintMode = true;
    service.setPaintTool('pen');
    service.penSize = 0.05;
    service.penThickness = 0.02;

    const element = document.createElement('canvas');
    (element as any).getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
    });

    const renderer = { domElement: element } as unknown as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera();
    const scene = new THREE.Scene();
    const cake = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    cake.updateMatrixWorld(true);
    const mouse = new THREE.Vector2();

    const baseIntersection = {
      point: new THREE.Vector3(0, 0.5, 0),
      face: { normal: new THREE.Vector3(0, 1, 0) },
      object: cake,
    } as unknown as THREE.Intersection;

    const raycasterSpy = jasmine.createSpyObj<THREE.Raycaster>('Raycaster', ['setFromCamera', 'intersectObject']);
    raycasterSpy.intersectObject.and.returnValue([baseIntersection]);

    spyOn(globalPerf, 'now').and.returnValues(100, 110, 220);

    service.beginStroke();
    await service.handlePaint(new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }), renderer, camera, scene, cake, mouse, raycasterSpy);
    const afterFirstStroke = scene.children.length;

    await service.handlePaint(new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }), renderer, camera, scene, cake, mouse, raycasterSpy);
    const afterSecondStroke = scene.children.length;

    expect(afterSecondStroke).toBe(afterFirstStroke);

    raycasterSpy.intersectObject.and.returnValue([
      { ...baseIntersection, point: new THREE.Vector3(0.06, 0.5, 0) } as THREE.Intersection,
    ]);

    await service.handlePaint(new MouseEvent('mousemove', { clientX: 130, clientY: 100, buttons: 1 }), renderer, camera, scene, cake, mouse, raycasterSpy);
    const afterThirdStroke = scene.children.length;

    expect(afterThirdStroke).toBeGreaterThan(afterSecondStroke);
  });
});
