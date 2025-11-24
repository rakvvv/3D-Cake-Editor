import * as THREE from 'three';
import { ThreeObjectsFactory } from './three-objects.factory';
import { CakeOptions } from '../models/cake.options';

describe('ThreeObjectsFactory', () => {
  const baseOptions: CakeOptions = {
    cake_size: 1,
    cake_color: '#ffffff',
    cake_text: false,
    cake_text_value: '',
    cake_text_position: 'top',
    cake_text_offset: 0,
    cake_text_font: 'helvetiker',
    cake_text_depth: 0.1,
    layers: 2,
    shape: 'cylinder',
    layerSizes: [1, 0.9],
    glaze_enabled: true,
    glaze_color: '#ff00ff',
    glaze_thickness: 0.2,
    glaze_drip_length: 0.4,
    glaze_seed: 1,
    wafer_texture_url: null,
    wafer_scale: 1,
    wafer_texture_zoom: 1,
    wafer_texture_offset_x: 0,
    wafer_texture_offset_y: 0,
  };

  const getOptions = (overrides: Partial<CakeOptions> = {}): CakeOptions => ({
    ...baseOptions,
    ...overrides,
    layerSizes: overrides.layerSizes ? [...overrides.layerSizes] : [...baseOptions.layerSizes],
  });

  const getGlazeGeometry = (glaze: THREE.Object3D): THREE.BufferGeometry => {
    const mesh = glaze.children.find((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh);
    expect(mesh).toBeTruthy();
    return (mesh as THREE.Mesh).geometry as THREE.BufferGeometry;
  };

  beforeEach(() => {
    const loader = (ThreeObjectsFactory as unknown as { textureLoader: THREE.TextureLoader }).textureLoader;
    spyOn(loader, 'load').and.callFake(() => new THREE.Texture());
    (ThreeObjectsFactory as unknown as { colorMap: THREE.Texture | null }).colorMap = null;
    (ThreeObjectsFactory as unknown as { bumpMap: THREE.Texture | null }).bumpMap = null;
    (ThreeObjectsFactory as unknown as { roughnessMap: THREE.Texture | null }).roughnessMap = null;
    (ThreeObjectsFactory as unknown as { glazeColorMap: THREE.Texture | null }).glazeColorMap = null;
    (ThreeObjectsFactory as unknown as { glazeNormalMap: THREE.Texture | null }).glazeNormalMap = null;
  });

  it('tworzy polewę, gdy jest włączona', () => {
    const result = ThreeObjectsFactory.createCake(getOptions());
    expect(result.glaze).toBeTruthy();
    expect(result.cake.children.some((child) => child.name === 'CakeGlaze')).toBeTrue();
  });

  it('nakłada opłatek z mapą alfa i skalowaniem', () => {
    const result = ThreeObjectsFactory.createCake(
      getOptions({ wafer_texture_url: 'blob:wafer', wafer_scale: 1.25 })
    );

    const wafer = result.cake.children.find((child) => child.userData['isCakeWafer']) as THREE.Mesh;
    expect(wafer).toBeTruthy();

    const material = wafer.material as THREE.MeshPhysicalMaterial;
    expect(material.map).toBe(material.alphaMap);

    const geometry = wafer.geometry as THREE.CircleGeometry | THREE.PlaneGeometry;
    if (geometry instanceof THREE.CircleGeometry) {
      expect(geometry.parameters['radius']).toBeCloseTo(2 * 1.25, 2);
    }

    expect(wafer.position.y).toBeGreaterThan(0.9);
    expect(wafer.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('ustawia przybliżenie i przesunięcie tekstury opłatka', () => {
    const result = ThreeObjectsFactory.createCake(
      getOptions({
        wafer_texture_url: 'blob:wafer',
        wafer_scale: 1,
        wafer_texture_zoom: 2,
        wafer_texture_offset_x: 0.25,
        wafer_texture_offset_y: -0.1,
      })
    );

    const wafer = result.cake.children.find((child) => child.userData['isCakeWafer']) as THREE.Mesh;
    expect(wafer).toBeTruthy();
    const texture = wafer.userData['waferTexture'] as THREE.Texture;

    expect(texture.repeat.x).toBeCloseTo(0.5, 2);
    expect(texture.repeat.y).toBeCloseTo(0.5, 2);
    expect(texture.offset.x).toBeCloseTo(0.375, 3);
    expect(texture.offset.y).toBeCloseTo(0.25 - 0.05, 3);

    const material = wafer.userData['waferMaterial'] as THREE.MeshPhysicalMaterial;
    expect(material.roughness).toBeLessThan(0.3);
    expect(material.clearcoat).toBeGreaterThan(0.6);
    expect(material.roughnessMap).toBeTruthy();
    expect(material.bumpMap).toBeTruthy();
    expect(material.bumpScale).toBeGreaterThan(0.05);
  });

  it('nie dodaje górnej tafli polewy, gdy opłatek jest włączony, ale zostawia rant i sople', () => {
    const result = ThreeObjectsFactory.createCake(getOptions({ wafer_texture_url: 'blob:wafer' }));

    expect(result.glaze).toBeTruthy();
    const glaze = result.glaze!;
    const topCap = glaze.children.find((child) => child.userData['isGlazeTop']);
    const hasRim = glaze.children.some((child) => (child as THREE.Mesh).geometry instanceof THREE.TorusGeometry);

    expect(topCap).toBeUndefined();
    expect(hasRim).toBeTrue();
    expect(glaze.children.length).toBeGreaterThan(0);
  });

  it('nie generuje polewy, gdy jest wyłączona', () => {
    const result = ThreeObjectsFactory.createCake(getOptions({ glaze_enabled: false }));
    expect(result.glaze).toBeUndefined();
    expect(result.cake.children.some((child) => child.name === 'CakeGlaze')).toBeFalse();
  });

  it('dostosowuje długość zacieków do parametru', () => {
    const shortResult = ThreeObjectsFactory.createCake(
      getOptions({ glaze_drip_length: 0.1, glaze_thickness: 0.15 })
    );
    const longResult = ThreeObjectsFactory.createCake(
      getOptions({ glaze_drip_length: 1.0, glaze_thickness: 0.15 })
    );

    expect(shortResult.glaze).toBeTruthy();
    expect(longResult.glaze).toBeTruthy();

    const shortBox = new THREE.Box3().setFromObject(shortResult.glaze!);
    const longBox = new THREE.Box3().setFromObject(longResult.glaze!);

    expect(longBox.min.y).toBeLessThan(shortBox.min.y);
    expect(shortBox.max.y).toBeCloseTo(longBox.max.y, 1);
  });

  it('prowadzi polewę nad górą tortu i pozwala jej miękko spływać po bokach', () => {
    const result = ThreeObjectsFactory.createCake(
      getOptions({ glaze_thickness: 0.25, glaze_drip_length: 0.8 })
    );

    expect(result.glaze).toBeTruthy();

    const glazeBox = new THREE.Box3().setFromObject(result.glaze!);
    const cakeTopY = result.metadata.layerDimensions[result.metadata.layerDimensions.length - 1]?.topY ?? 0;

    expect(glazeBox.max.y).toBeGreaterThan(cakeTopY + 0.02);
    expect(glazeBox.min.y).toBeLessThan(cakeTopY - 0.05);

    const positionAttribute = getGlazeGeometry(result.glaze!).getAttribute('position');
    expect(positionAttribute).toBeTruthy();
    const vertexCount = (positionAttribute as THREE.BufferAttribute).count;
    expect(vertexCount).toBeGreaterThan(300);
  });

  it('buduje nieregularne, oddzielone zacieki oraz gładką kopułę na górze', () => {
    const result = ThreeObjectsFactory.createCake(
      getOptions({ glaze_thickness: 0.22, glaze_drip_length: 1.0 })
    );

    expect(result.glaze).toBeTruthy();

    const positions = Array.from(
      (getGlazeGeometry(result.glaze!).getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>
    );
    const totalVertices = positions.length / 3;
    const segments = (totalVertices - 1) / 6;

    const tipRingStart = segments * 5;
    const tipY = positions
      .slice(tipRingStart * 3, tipRingStart * 3 + segments * 3)
      .filter((_, index) => index % 3 === 1);
    const tipRange = Math.max(...tipY) - Math.min(...tipY);

    const apexRingStart = 0;
    const crownRingStart = segments;
    const apexY = positions
      .slice(apexRingStart * 3, apexRingStart * 3 + segments * 3)
      .filter((_, index) => index % 3 === 1);
    const crownY = positions
      .slice(crownRingStart * 3, crownRingStart * 3 + segments * 3)
      .filter((_, index) => index % 3 === 1);

    const averageApexHeight = apexY.reduce((sum, value) => sum + value, 0) / apexY.length;
    const averageCrownHeight = crownY.reduce((sum, value) => sum + value, 0) / crownY.length;

    const hangingDrips = tipY.filter((value) => value < averageCrownHeight - 0.2).length;

    expect(segments).toBeGreaterThan(100);
    expect(tipRange).toBeGreaterThan(0.35);
    expect(averageApexHeight - averageCrownHeight).toBeGreaterThan(0.05);
    expect(hangingDrips / tipY.length).toBeGreaterThan(0.25);
  });
});
