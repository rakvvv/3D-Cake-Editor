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
  };

  const getOptions = (overrides: Partial<CakeOptions> = {}): CakeOptions => ({
    ...baseOptions,
    ...overrides,
    layerSizes: overrides.layerSizes ? [...overrides.layerSizes] : [...baseOptions.layerSizes],
  });

  beforeEach(() => {
    const loader = (ThreeObjectsFactory as unknown as { textureLoader: THREE.TextureLoader }).textureLoader;
    spyOn(loader, 'load').and.callFake(() => new THREE.Texture());
    (ThreeObjectsFactory as unknown as { colorMap: THREE.Texture | null }).colorMap = null;
    (ThreeObjectsFactory as unknown as { bumpMap: THREE.Texture | null }).bumpMap = null;
    (ThreeObjectsFactory as unknown as { roughnessMap: THREE.Texture | null }).roughnessMap = null;
  });

  it('tworzy polewę, gdy jest włączona', () => {
    const result = ThreeObjectsFactory.createCake(getOptions());
    expect(result.glaze).toBeTruthy();
    expect(result.cake.children.some((child) => child.name === 'CakeGlaze')).toBeTrue();
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
});
