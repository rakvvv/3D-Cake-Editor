import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { PaintService } from './paint.service';
import { DecorationFactory } from '../factories/decoration.factory';
import { TransformManagerService } from './transform-manager.service';
import { SnapService } from './snap.service';

if (typeof performance === 'undefined') {
  (globalThis as any).performance = {
    now: () => Date.now(),
  } as Performance;
}

const globalPerf: Performance = (globalThis as any).performance;

const findStrokeGroup = (scene: THREE.Scene): THREE.Group | undefined =>
  scene.children.find(
    (child) => child instanceof THREE.Group && child.userData['isPaintStroke'],
  ) as THREE.Group | undefined;

const countStrokeMeshes = (group: THREE.Group, geometryType: string): number =>
  group.children.filter(
    (child) =>
      child instanceof THREE.Mesh && child.userData['isPaintStroke'] && child.geometry.type === geometryType,
  ).length;

const collectStrokeMeshes = (group: THREE.Group): THREE.Mesh[] =>
  group.children.filter(
    (child) => child instanceof THREE.Mesh && child.userData['isPaintStroke'],
  ) as THREE.Mesh[];

const getStrokeCylinderLengths = (group: THREE.Group): number[] =>
  group.children
    .filter(
      (child) =>
        child instanceof THREE.Mesh &&
        child.userData['isPaintStroke'] &&
        child.geometry.type === 'CylinderGeometry',
    )
    .map((child) => (child as THREE.Mesh).scale.y);

describe('PaintService', () => {
  let service: PaintService;
  let transformManager: jasmine.SpyObj<TransformManagerService>;
  let snapService: jasmine.SpyObj<SnapService>;

  beforeEach(() => {
    const transformManagerSpy = jasmine.createSpyObj<TransformManagerService>('TransformManagerService', [
      'removeDecorationObject',
    ]);
    const snapServiceSpy = jasmine.createSpyObj<SnapService>('SnapService', ['snapDecorationToCake']);
    snapServiceSpy.snapDecorationToCake.and.returnValue({ success: true, surfaceType: 'TOP', message: '' });
    TestBed.configureTestingModule({
      providers: [
        PaintService,
        { provide: TransformManagerService, useValue: transformManagerSpy },
        { provide: SnapService, useValue: snapServiceSpy },
      ],
    });
    service = TestBed.inject(PaintService);
    transformManager = TestBed.inject(
      TransformManagerService,
    ) as jasmine.SpyObj<TransformManagerService>;
    snapService = TestBed.inject(SnapService) as jasmine.SpyObj<SnapService>;
  });

  it('zapamiętuje ostatnie narzędzie inne niż gumka', () => {
    expect(service.getLastNonEraserTool()).toBe('decoration');

    service.setPaintTool('pen');
    expect(service.getLastNonEraserTool()).toBe('pen');

    service.setPaintTool('eraser');
    expect(service.getLastNonEraserTool()).toBe('pen');

    service.setPaintTool('decoration');
    expect(service.getLastNonEraserTool()).toBe('decoration');
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

    const strokeGroup = findStrokeGroup(scene);
    expect(strokeGroup).toBeDefined();

    const initialCylinders = countStrokeMeshes(strokeGroup!, 'CylinderGeometry');
    expect(initialCylinders).toBe(0);

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    const afterSkipCylinders = countStrokeMeshes(strokeGroup!, 'CylinderGeometry');
    expect(afterSkipCylinders).toBe(initialCylinders);

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

    const afterMoveCylinders = countStrokeMeshes(strokeGroup!, 'CylinderGeometry');
    expect(afterMoveCylinders).toBeGreaterThan(initialCylinders);
  });

  it('dodaje gładkie łączenia przy zmianie kierunku dla grubego pisaka', async () => {
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

    spyOn(globalPerf, 'now').and.returnValues(300, 320, 340, 360);

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

    raycasterSpy.intersectObject.and.returnValue([
      { ...baseIntersection, point: new THREE.Vector3(0.08, 0.5, 0) } as THREE.Intersection,
    ]);
    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 140, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    raycasterSpy.intersectObject.and.returnValue([
      { ...baseIntersection, point: new THREE.Vector3(0.14, 0.5, 0.06) } as THREE.Intersection,
    ]);
    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 160, clientY: 130, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    const strokeGroup = findStrokeGroup(scene);
    expect(strokeGroup).toBeDefined();
    const strokeMeshes = collectStrokeMeshes(strokeGroup!);

    const cylinders = strokeMeshes.filter((mesh) => mesh.geometry.type === 'CylinderGeometry');
    expect(cylinders.length).toBeGreaterThanOrEqual(2);

    const firstCylinder = cylinders[0];
    const firstCylinderGeometry = firstCylinder.geometry as THREE.CylinderGeometry;
    const finalRadius = firstCylinderGeometry.parameters.radiusTop * firstCylinder.scale.x;
    expect(finalRadius).toBeCloseTo(service.penThickness * 0.5, 6);

    const spheres = strokeMeshes.filter((mesh) => mesh.geometry.type === 'SphereGeometry');
    expect(spheres.length).toBeGreaterThanOrEqual(2);

    const largestSphereScale = Math.max(...spheres.map((mesh) => mesh.scale.x));
    const jointCandidates = spheres.filter((mesh) => mesh.scale.x < largestSphereScale * 0.75);
    expect(jointCandidates.length).toBeGreaterThan(0);
    jointCandidates.forEach((joint) => {
      expect(joint.scale.x / 2).toBeGreaterThan(service.penThickness * 0.5 * 0.99);
      expect(joint.scale.x).toBeLessThan(largestSphereScale);
    });
  });

  it('pozwala niezależnie kontrolować końcówki i grubość linii', async () => {
    service.paintMode = true;
    service.setPaintTool('pen');
    service.penSize = 0.12;
    service.penThickness = 0.04;

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

    spyOn(globalPerf, 'now').and.returnValues(900, 930, 960);

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

    raycasterSpy.intersectObject.and.returnValue([
      { ...baseIntersection, point: new THREE.Vector3(0.05, 0.5, 0) } as THREE.Intersection,
    ]);
    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 120, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    const strokeGroup = findStrokeGroup(scene);
    expect(strokeGroup).toBeDefined();
    const strokeMeshes = collectStrokeMeshes(strokeGroup!);

    const cylinders = strokeMeshes.filter((mesh) => mesh.geometry.type === 'CylinderGeometry');
    expect(cylinders.length).toBeGreaterThan(0);
    cylinders.forEach((mesh) => {
      const geometry = mesh.geometry as THREE.CylinderGeometry;
      const renderedRadius = geometry.parameters.radiusTop * mesh.scale.x;
      expect(renderedRadius).toBeCloseTo(service.penThickness * 0.5, 6);
    });

    const spheres = strokeMeshes.filter((mesh) => mesh.geometry.type === 'SphereGeometry');
    expect(spheres.length).toBe(2);
    spheres.forEach((cap) => {
      expect(cap.scale.x / 2).toBeGreaterThan(service.penThickness * 0.5 + 0.005);
    });
  });

  it('utrzymuje pisak odsunięty od pionowej powierzchni tortu', async () => {
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
      point: new THREE.Vector3(0.5, 0.4, 0),
      face: { normal: new THREE.Vector3(1, 0, 0) },
      object: cake,
    } as unknown as THREE.Intersection;

    const raycasterSpy = jasmine.createSpyObj<THREE.Raycaster>('Raycaster', ['setFromCamera', 'intersectObject']);
    raycasterSpy.intersectObject.and.returnValue([baseIntersection]);

    spyOn(globalPerf, 'now').and.returnValues(400, 440, 480);

    service.beginStroke(renderer.domElement.getBoundingClientRect() as DOMRect);
    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 80, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    raycasterSpy.intersectObject.and.returnValue([
      { ...baseIntersection, point: new THREE.Vector3(0.5, 0.6, 0) } as THREE.Intersection,
    ]);

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 110, clientY: 60, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    const strokeGroup = findStrokeGroup(scene);
    expect(strokeGroup).toBeDefined();
    const strokeMeshes = collectStrokeMeshes(strokeGroup!);
    const cylinders = strokeMeshes.filter((mesh) => mesh.geometry.type === 'CylinderGeometry');
    expect(cylinders.length).toBeGreaterThan(0);

    const minCenterX = Math.min(...cylinders.map((mesh) => mesh.position.x));
    const maxCenterX = Math.max(...cylinders.map((mesh) => mesh.position.x));

    expect(minCenterX).toBeGreaterThan(0.5 + service.penThickness * 0.2);
    expect(maxCenterX).toBeLessThan(0.5 + service.penThickness * 1.2);
  });

  it('skaluje liczbę segmentów cylindrycznych wraz z długością pociągnięcia', async () => {
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

    let currentTime = 1000;
    spyOn(globalPerf, 'now').and.callFake(() => {
      currentTime += 40;
      return currentTime;
    });

    const renderRect = renderer.domElement.getBoundingClientRect() as DOMRect;

    const buildStroke = async (
      offset: THREE.Vector3,
    ): Promise<{ count: number; maxLength: number }> => {
      scene.clear();
      service.beginStroke(renderRect);
      await service.handlePaint(
        new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
        renderer,
        camera,
        scene,
        cake,
        mouse,
        raycasterSpy,
      );

      raycasterSpy.intersectObject.and.returnValue([
        { ...baseIntersection, point: offset } as THREE.Intersection,
      ]);

      await service.handlePaint(
        new MouseEvent('mousemove', { clientX: 160, clientY: 100, buttons: 1 }),
        renderer,
        camera,
        scene,
        cake,
        mouse,
        raycasterSpy,
      );

      const strokeGroup = findStrokeGroup(scene);
      expect(strokeGroup).toBeDefined();
      const count = countStrokeMeshes(strokeGroup!, 'CylinderGeometry');
      const lengths = getStrokeCylinderLengths(strokeGroup!);
      const maxLength = lengths.length ? Math.max(...lengths) : 0;
      return { count, maxLength };
    };

    const shortStroke = await buildStroke(new THREE.Vector3(0.05, 0.5, 0));
    const longStroke = await buildStroke(new THREE.Vector3(0.45, 0.5, 0));

    expect(shortStroke.maxLength).toBeGreaterThan(0);
    expect(longStroke.count).toBeGreaterThan(0);
    expect(longStroke.maxLength).toBeGreaterThan(shortStroke.maxLength * 1.5);
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

  it('śledzi dodanie zwykłej dekoracji dla undo/redo', () => {
    const scene = new THREE.Scene();
    const decoration = new THREE.Group();
    decoration.userData['isDecoration'] = true;
    scene.add(decoration);

    service.registerScene(scene);
    service.registerDecorationAddition(decoration);

    expect(service.canUndo()).toBeTrue();

    service.undo();
    expect(scene.children.includes(decoration)).toBeFalse();
    expect(service.canRedo()).toBeTrue();

    service.redo();
    expect(scene.children.includes(decoration)).toBeTrue();
  });

  it('usuwa dekoracje trafione gumką i czyści stosy historii', async () => {
    service.paintMode = true;
    service.setPaintTool('eraser');

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

    const decoration = new THREE.Group();
    decoration.userData['isDecoration'] = true;
    scene.add(decoration);

    (service as any).undoStack = [decoration];
    (service as any).redoStack = [decoration];

    transformManager.removeDecorationObject.and.callFake((object) => {
      scene.remove(object);
    });

    const raycasterSpy = jasmine.createSpyObj<THREE.Raycaster>('Raycaster', [
      'setFromCamera',
      'intersectObject',
      'intersectObjects',
    ]);
    raycasterSpy.intersectObject.and.returnValue([baseIntersection]);
    const decorationIntersection = {
      distance: 0,
      point: new THREE.Vector3(),
      object: decoration,
    } as unknown as THREE.Intersection;

    raycasterSpy.intersectObjects.and.returnValue([decorationIntersection]);

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    expect(transformManager.removeDecorationObject).toHaveBeenCalledWith(decoration);
    expect(scene.children.includes(decoration)).toBeFalse();
    expect((service as any).undoStack).toEqual([]);
    expect((service as any).redoStack).toEqual([]);
  });

  it('usuwa dekoracje malowane pędzlem trafione gumką', async () => {
    service.paintMode = true;
    service.setPaintTool('eraser');

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

    const decoration = new THREE.Group();
    decoration.userData['isPaintDecoration'] = true;
    scene.add(decoration);

    (service as any).undoStack = [decoration];
    (service as any).redoStack = [decoration];

    transformManager.removeDecorationObject.and.callFake((object) => {
      scene.remove(object);
    });

    const raycasterSpy = jasmine.createSpyObj<THREE.Raycaster>('Raycaster', [
      'setFromCamera',
      'intersectObject',
      'intersectObjects',
    ]);
    raycasterSpy.intersectObject.and.returnValue([baseIntersection]);
    const decorationIntersection = {
      distance: 0,
      point: new THREE.Vector3(),
      object: decoration,
    } as unknown as THREE.Intersection;

    raycasterSpy.intersectObjects.and.returnValue([decorationIntersection]);

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    expect(transformManager.removeDecorationObject).toHaveBeenCalledWith(decoration);
    expect(scene.children.includes(decoration)).toBeFalse();
    expect((service as any).undoStack).toEqual([]);
    expect((service as any).redoStack).toEqual([]);
  });

  it('usuwa segmenty pisaka trafione gumką bez wywołania usuwania dekoracji', async () => {
    service.paintMode = true;
    service.setPaintTool('eraser');

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

    const strokeGroup = new THREE.Group();
    strokeGroup.userData['isPaintStroke'] = true;
    const segment = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    segment.userData['isPaintStroke'] = true;
    strokeGroup.add(segment);
    scene.add(strokeGroup);

    (service as any).undoStack = [strokeGroup];
    (service as any).redoStack = [strokeGroup];

    const raycasterSpy = jasmine.createSpyObj<THREE.Raycaster>('Raycaster', [
      'setFromCamera',
      'intersectObject',
      'intersectObjects',
    ]);
    raycasterSpy.intersectObject.and.returnValue([baseIntersection]);
    const strokeIntersection = {
      distance: 0,
      point: new THREE.Vector3(),
      object: segment,
    } as unknown as THREE.Intersection;

    raycasterSpy.intersectObjects.and.returnValue([strokeIntersection]);

    await service.handlePaint(
      new MouseEvent('mousemove', { clientX: 100, clientY: 100, buttons: 1 }),
      renderer,
      camera,
      scene,
      cake,
      mouse,
      raycasterSpy,
    );

    expect(transformManager.removeDecorationObject).not.toHaveBeenCalled();
    expect(scene.children.includes(strokeGroup)).toBeFalse();
    expect((service as any).undoStack).toEqual([]);
    expect((service as any).redoStack).toEqual([]);
  });
});
