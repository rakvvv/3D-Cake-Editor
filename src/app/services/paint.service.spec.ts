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

    service.beginStroke(renderer.domElement.getBoundingClientRect() as DOMRect);
    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    const strokeGroup = scene.children.find(
      (child) => child instanceof THREE.Group && child.userData['isPaintStroke'],
    ) as THREE.Group | undefined;

    expect(strokeGroup).toBeDefined();
    const group = strokeGroup as THREE.Group;
    const curveMesh = group.children.find(
      (child) =>
        child instanceof THREE.Mesh &&
        child.userData['isPaintStroke'] &&
        child.geometry.type !== 'SphereGeometry',
    ) as THREE.Mesh | undefined;

    expect(curveMesh).toBeDefined();
    const strokeMesh = curveMesh as THREE.Mesh;
    const initialGeometryId = strokeMesh.geometry.uuid;

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );
    const geometryAfterSkip = strokeMesh.geometry.uuid;

    expect(geometryAfterSkip).toBe(initialGeometryId);

    raycasterSpy.intersectObject.and.returnValue([
      { ...baseIntersection, point: new THREE.Vector3(0.06, 0.5, 0) } as THREE.Intersection,
    ]);

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 130, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );
    expect(strokeMesh.geometry.type).toBe('TubeGeometry');
    expect(strokeMesh.visible).toBeTrue();
    expect(strokeMesh.geometry.uuid).not.toBe(initialGeometryId);
  });

  it('utrzymuje ciągłą linię dla grubego pisaka przy niewielkich ruchach', async () => {
    service.paintMode = true;
    service.setPaintTool('pen');
    service.penSize = 0.2;
    service.penThickness = 0.1;

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

    spyOn(globalPerf, 'now').and.returnValues(300, 320, 330);

    service.beginStroke(renderer.domElement.getBoundingClientRect() as DOMRect);
    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    const strokeGroup = scene.children.find(
      (child) => child instanceof THREE.Group && child.userData['isPaintStroke'],
    ) as THREE.Group | undefined;

    expect(strokeGroup).toBeDefined();
    const group = strokeGroup as THREE.Group;
    const curveMesh = group.children.find(
      (child) =>
        child instanceof THREE.Mesh &&
        child.userData['isPaintStroke'] &&
        child.geometry.type !== 'SphereGeometry',
    ) as THREE.Mesh | undefined;

    expect(curveMesh).toBeDefined();
    const strokeMesh = curveMesh as THREE.Mesh;
    expect(strokeMesh.visible).toBeFalse();

    raycasterSpy.intersectObject.and.returnValue([
      { ...baseIntersection, point: new THREE.Vector3(0.018, 0.5, 0) } as THREE.Intersection,
    ]);

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 110, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    expect(strokeMesh.geometry.type).toBe('TubeGeometry');
    expect(strokeMesh.visible).toBeTrue();
    const tubeGeometry = strokeMesh.geometry as THREE.TubeGeometry;
    expect(tubeGeometry.parameters.radius).toBeCloseTo(service.penSize, 6);
    expect(tubeGeometry.parameters.radialSegments).toBeGreaterThanOrEqual(16);
    expect(tubeGeometry.parameters.tubularSegments).toBeGreaterThanOrEqual(18);
    expect((tubeGeometry.parameters.path as THREE.CatmullRomCurve3).type).toBe('centripetal');

    const capCount = group.children.filter(
      (child) => child instanceof THREE.Mesh && child.geometry.type === 'SphereGeometry',
    ).length;
    expect(capCount).toBe(2);
  });

  it('zwiększa zagęszczenie segmentów tuby przy długich pociągnięciach', async () => {
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

    spyOn(globalPerf, 'now').and.returnValues(500, 520, 640);

    service.beginStroke(renderer.domElement.getBoundingClientRect() as DOMRect);
    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    const strokeGroup = scene.children.find(
      (child) => child instanceof THREE.Group && child.userData['isPaintStroke'],
    ) as THREE.Group | undefined;
    expect(strokeGroup).toBeDefined();

    raycasterSpy.intersectObject.and.returnValue([
      { ...baseIntersection, point: new THREE.Vector3(0.45, 0.5, 0) } as THREE.Intersection,
    ]);

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 180, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    const group = strokeGroup as THREE.Group;
    const curveMesh = group.children.find(
      (child) =>
        child instanceof THREE.Mesh && child.userData['isPaintStroke'] && child.geometry.type !== 'SphereGeometry',
    ) as THREE.Mesh | undefined;

    expect(curveMesh).toBeDefined();
    const tubeGeometry = (curveMesh as THREE.Mesh).geometry as THREE.TubeGeometry;
    expect(tubeGeometry.parameters.tubularSegments).toBeGreaterThanOrEqual(36);
    expect((tubeGeometry.parameters.path as THREE.CatmullRomCurve3).type).toBe('centripetal');
  });

  it('pozwala cofnąć i przywrócić dodane dekoracje 3D', async () => {
    service.paintMode = true;
    service.setPaintTool('decoration');
    service.setCurrentBrush('brush.glb');

    const template = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.geometry.computeBoundingBox();
    template.add(mesh);

    spyOn(DecorationFactory, 'loadDecorationModel').and.returnValue(Promise.resolve(template));

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

    const intersection = {
      point: new THREE.Vector3(0, 0.5, 0),
      face: { normal: new THREE.Vector3(0, 1, 0) },
      object: cake,
    } as unknown as THREE.Intersection;

    const raycasterSpy = jasmine.createSpyObj<THREE.Raycaster>('Raycaster', ['setFromCamera', 'intersectObject']);
    raycasterSpy.intersectObject.and.returnValue([intersection]);

    service.registerScene(scene);
    service.beginStroke(renderer.domElement.getBoundingClientRect() as DOMRect);
    await service.handlePaint(
      new MouseEvent('mousedown', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );
    service.endStroke();

    const paintedBeforeUndo = scene.children.filter((child) => child.userData['isPaintDecoration']).length;
    expect(paintedBeforeUndo).toBe(1);
    expect(service.canUndo()).toBeTrue();

    service.undo();
    const paintedAfterUndo = scene.children.filter((child) => child.userData['isPaintDecoration']).length;
    expect(paintedAfterUndo).toBe(0);
    expect(service.canRedo()).toBeTrue();

    service.redo();
    const paintedAfterRedo = scene.children.filter((child) => child.userData['isPaintDecoration']).length;
    expect(paintedAfterRedo).toBe(1);
  });
});
