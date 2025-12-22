import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import * as THREE from 'three';
import { PaintService } from './paint.service';
import { DecorationFactory } from '../factories/decoration.factory';
import { TransformManagerService } from './transform-manager.service';
import { SnapService } from './snap.service';
import { DecorationsService } from './decorations.service';
import { CakeMetadata } from '../factories/three-objects.factory';
import { CreamRingPreset } from '../models/cream-presets';

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

const findDecorationGroup = (scene: THREE.Scene): THREE.Group | undefined =>
  scene.children.find(
    (child) => child instanceof THREE.Group && child.userData['isPaintDecoration'],
  ) as THREE.Group | undefined;

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
    const snapServiceSpy = jasmine.createSpyObj<SnapService>('SnapService', [
      'snapDecorationToCake',
      'getCakeMetadataSnapshot',
    ]);
    snapServiceSpy.snapDecorationToCake.and.returnValue({ success: true, surfaceType: 'TOP', message: '' });
    snapServiceSpy.getCakeMetadataSnapshot.and.returnValue(null);
    const decorationsServiceSpy = jasmine.createSpyObj<DecorationsService>('DecorationsService', [
      'getDecorationInfo',
    ]);
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PaintService,
        { provide: TransformManagerService, useValue: transformManagerSpy },
        { provide: SnapService, useValue: snapServiceSpy },
        { provide: DecorationsService, useValue: decorationsServiceSpy },
      ],
    });
    service = TestBed.inject(PaintService);
    transformManager = TestBed.inject(
      TransformManagerService,
    ) as jasmine.SpyObj<TransformManagerService>;
    snapService = TestBed.inject(SnapService) as jasmine.SpyObj<SnapService>;
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

  it('applies decoration initialScale only once when placing a brush', async () => {
    const brushId = 'decor.glb';
    service.currentBrush = brushId;
    service.setBrushMetadata(brushId, { initialScale: 0.5 });

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    const template = new THREE.Group();
    template.add(mesh);

    spyOn(DecorationFactory, 'loadDecorationModel').and.returnValue(Promise.resolve(template));

    const scene = new THREE.Scene();
    const meshForHit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    meshForHit.updateMatrixWorld(true);
    const hit = {
      point: new THREE.Vector3(0, 0, 0),
      face: { normal: new THREE.Vector3(0, 1, 0) },
      object: meshForHit,
    } as unknown as THREE.Intersection;

    await (service as any).placeDecorationBrush(hit, scene);

    const decorationGroup = findDecorationGroup(scene);
    expect(decorationGroup).toBeDefined();

    const instanced = decorationGroup!.children.find(
      (child) => child instanceof THREE.InstancedMesh,
    ) as THREE.InstancedMesh | undefined;
    expect(instanced).toBeDefined();
    expect(instanced!.count).toBeGreaterThan(0);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    instanced!.getMatrixAt(0, matrix);
    matrix.decompose(position, rotation, scale);

    const geometrySize = new THREE.Vector3();
    (instanced!.geometry.boundingBox as THREE.Box3).getSize(geometrySize);
    const finalSize = geometrySize.clone().multiply(scale);

    expect(finalSize.x).toBeCloseTo(0.5, 6);
    expect(finalSize.y).toBeCloseTo(0.5, 6);
    expect(finalSize.z).toBeCloseTo(0.5, 6);
  });

  it('respects paintInitialRotation from decoration metadata when placing a brush', async () => {
    const brushId = 'paintable.glb';
    service.currentBrush = brushId;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    const template = new THREE.Group();
    template.add(mesh);

    const decorationInfo = {
      id: 'paintable',
      name: 'Paintable',
      modelFileName: brushId,
      type: 'BOTH' as const,
      paintInitialRotation: [0, 90, 0] as [number, number, number],
    };

    const decorationsService = TestBed.inject(DecorationsService) as jasmine.SpyObj<DecorationsService>;
    decorationsService.getDecorationInfo.and.returnValue(decorationInfo);

    spyOn(DecorationFactory, 'loadDecorationModel').and.returnValue(Promise.resolve(template));

    const scene = new THREE.Scene();
    const meshForHit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    meshForHit.updateMatrixWorld(true);
    const hit = {
      point: new THREE.Vector3(0, 0, 0),
      face: { normal: new THREE.Vector3(0, 1, 0) },
      object: meshForHit,
    } as unknown as THREE.Intersection;

    await (service as any).placeDecorationBrush(hit, scene);

    const decorationGroup = findDecorationGroup(scene);
    expect(decorationGroup).toBeDefined();

    const instanced = decorationGroup!.children.find(
      (child) => child instanceof THREE.InstancedMesh,
    ) as THREE.InstancedMesh | undefined;
    expect(instanced).toBeDefined();

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    instanced!.getMatrixAt(0, matrix);
    matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());

    const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
    expect(THREE.MathUtils.radToDeg(euler.y)).toBeCloseTo(90, 6);
  });

  it('uses decoration placement overrides from brush metadata when painting', async () => {
    const brushId = 'override.glb';
    service.currentBrush = brushId;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    const template = new THREE.Group();
    template.add(mesh);

    const decorationInfo = {
      id: 'override',
      name: 'Override',
      modelFileName: brushId,
      type: 'BOTH' as const,
    };

    const decorationsService = TestBed.inject(DecorationsService) as jasmine.SpyObj<DecorationsService>;
    decorationsService.getDecorationInfo.and.returnValue(decorationInfo);

    service.setBrushMetadata(brushId, {
      paintInitialRotation: [0, 45, 0],
      surfaceOffset: 0.01,
      modelUpAxis: 'Y',
      modelForwardAxis: 'Z',
      faceOutwardOnSides: false,
    });

    spyOn(DecorationFactory, 'loadDecorationModel').and.returnValue(Promise.resolve(template));

    const scene = new THREE.Scene();
    const meshForHit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    meshForHit.updateMatrixWorld(true);
    const hit = {
      point: new THREE.Vector3(0, 0, 0),
      face: { normal: new THREE.Vector3(0, 1, 0) },
      object: meshForHit,
    } as unknown as THREE.Intersection;

    await (service as any).placeDecorationBrush(hit, scene);

    const decorationGroup = findDecorationGroup(scene);
    expect(decorationGroup).toBeDefined();

    const instanced = decorationGroup!.children.find(
      (child) => child instanceof THREE.InstancedMesh,
    ) as THREE.InstancedMesh | undefined;
    expect(instanced).toBeDefined();

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    instanced!.getMatrixAt(0, matrix);
    matrix.decompose(position, rotation, scale);

    const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');

    expect(position.y).toBeCloseTo(0.01, 6);
    expect(THREE.MathUtils.radToDeg(euler.y)).toBeCloseTo(45, 6);
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

  it('builds cuboid ring presets along the rectangular perimeter', () => {
    const preset: CreamRingPreset = {
      id: 'cuboid-ring',
      name: 'Cuboid Ring',
      mode: 'RING',
      layerIndex: 0,
      position: 'SIDE_ARC',
      startAngleDeg: 0,
      endAngleDeg: 360,
      radiusOffset: 0.01,
    };

    const metadata: CakeMetadata = {
      shape: 'cuboid',
      layers: 1,
      layerHeight: 1,
      totalHeight: 1,
      layerSizes: [1],
      layerDimensions: [
        { index: 0, size: 1, height: 1, topY: 1, bottomY: 0, width: 2, depth: 1 },
      ],
      width: 2,
      depth: 1,
    };

    const path = (service as any).buildExtruderPath(preset, metadata);

    expect(path.length).toBe(123);
    expect(path[0].position.x).toBeCloseTo(1.01, 4);
    expect(path[0].position.z).toBeCloseTo(0, 4);
    expect(path[0].normal).toEqual(new THREE.Vector3(1, 0, 0));
    expect(path[0].tangent).toEqual(new THREE.Vector3(0, 0, 1));

    const quarter = path[Math.floor(path.length / 4)];
    expect(quarter.normal).toEqual(new THREE.Vector3(0, 0, 1));
    expect(quarter.tangent).toEqual(new THREE.Vector3(-1, 0, 0));

    const halfway = path[Math.floor(path.length / 2)];
    expect(halfway.position.x).toBeCloseTo(-1.01, 4);
    expect(halfway.normal).toEqual(new THREE.Vector3(-1, 0, 0));
    expect(halfway.tangent).toEqual(new THREE.Vector3(0, 0, -1));
  });

  it('maps cuboid path presets using perimeter-based spacing', () => {
    const preset: CreamRingPreset = {
      id: 'cuboid-path',
      name: 'Cuboid Path',
      mode: 'PATH',
      layerIndex: 0,
      position: 'SIDE_ARC',
      nodes: [
        { angleDeg: 0, heightNorm: 0.4 },
        { angleDeg: 90, heightNorm: 0.6 },
      ],
    };

    const metadata: CakeMetadata = {
      shape: 'cuboid',
      layers: 1,
      layerHeight: 1,
      totalHeight: 1,
      layerSizes: [1],
      layerDimensions: [
        { index: 0, size: 1, height: 1, topY: 1, bottomY: 0, width: 2, depth: 1 },
      ],
      width: 2,
      depth: 1,
    };

    const path = (service as any).buildExtruderPath(preset, metadata);

    expect(path.length).toBe(31);
    expect(path[0].normal).toEqual(new THREE.Vector3(1, 0, 0));
    expect(path[0].tangent).toEqual(new THREE.Vector3(0, 0, 1));
    expect(path[path.length - 1].normal).toEqual(new THREE.Vector3(0, 0, 1));
    expect(path[path.length - 1].tangent).toEqual(new THREE.Vector3(-1, 0, 0));
  });

  it('renders cuboid path markers along the rectangular perimeter', () => {
    const preset: CreamRingPreset = {
      id: 'cuboid-markers',
      name: 'Cuboid Markers',
      mode: 'PATH',
      layerIndex: 0,
      position: 'SIDE_ARC',
      radiusOffset: 0.05,
      nodes: [
        { angleDeg: 0, heightNorm: 0.4 },
        { angleDeg: 90, heightNorm: 0.6 },
        { angleDeg: 135, heightNorm: 0.5 },
      ],
    };

    const metadata: CakeMetadata = {
      shape: 'cuboid',
      layers: 1,
      layerHeight: 1,
      totalHeight: 1,
      layerSizes: [1],
      layerDimensions: [
        { index: 0, size: 1, height: 1, topY: 1, bottomY: 0, width: 2, depth: 1 },
      ],
      width: 2,
      depth: 1,
    };

    snapService.getCakeMetadataSnapshot.and.returnValue(metadata);

    const scene = new THREE.Scene();
    (service as any).stateStore.setScene(scene);
    (service as any).stateStore.setCakeBase(new THREE.Object3D());

    service.setExtruderPathNodes(preset.nodes ?? [], preset);

    const markers = (service as any).extruderPathMarkers as THREE.Mesh[];
    expect(markers.length).toBe(3);
    expect(markers[0].position.x).toBeCloseTo(1.062, 3);
    expect(markers[0].position.z).toBeCloseTo(0, 5);
    expect(markers[1].position.z).toBeCloseTo(0.562, 3);
    expect(markers[1].position.x).toBeCloseTo(0, 3);
    expect(markers[2].position.x).toBeCloseTo(-0.55, 2);
    expect(markers[2].position.z).toBeCloseTo(0.562, 3);
  });

});
