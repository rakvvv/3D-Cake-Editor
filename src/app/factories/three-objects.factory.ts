import * as THREE from 'three';
import { CakeOptions } from '../models/cake.options';

export interface CakeMetadata {
  shape: CakeOptions['shape'];
  layers: number;
  layerHeight: number;
  totalHeight: number;
  radius?: number;
  width?: number;
  depth?: number;
}

export interface CakeCreationResult {
  cake: THREE.Group;
  layers: THREE.Mesh[];
  material: THREE.MeshStandardMaterial;
  metadata: CakeMetadata;
}

export class ThreeObjectsFactory {
  private static textureLoader = new THREE.TextureLoader();
  private static colorMap: THREE.Texture | null = null;
  private static bumpMap: THREE.Texture | null = null;
  private static roughnessMap: THREE.Texture | null = null;

  private static ensureTexturesLoaded(): void {
    if (this.colorMap && this.bumpMap && this.roughnessMap) {
      return;
    }

    this.colorMap = this.textureLoader.load('/assets/textures/cake_color.jpg');
    this.bumpMap = this.textureLoader.load('/assets/textures/cake_bump.jpg');
    this.roughnessMap = this.textureLoader.load('/assets/textures/cake_roughness.jpg');

    [this.colorMap, this.bumpMap, this.roughnessMap].forEach((texture) => {
      if (!texture) {
        return;
      }
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2, 2);
    });
  }

  private static createCakeMaterial(color: string): THREE.MeshStandardMaterial {
    this.ensureTexturesLoaded();

    const material = new THREE.MeshStandardMaterial({
      map: this.colorMap ?? undefined,
      bumpMap: this.bumpMap ?? undefined,
      bumpScale: 0.1,
      roughnessMap: this.roughnessMap ?? undefined,
      roughness: 0.7,
      metalness: 0.0,
    });

    material.color = new THREE.Color(color);
    return material;
  }

  public static createCake(options: CakeOptions): CakeCreationResult {
    const layerHeight = 2;
    const baseRadius = 2;
    const material = this.createCakeMaterial(options.cake_color);

    const metadata: CakeMetadata = {
      shape: options.shape,
      layers: options.layers,
      layerHeight,
      totalHeight: layerHeight * options.layers,
      radius: options.shape === 'cylinder' ? baseRadius : undefined,
      width: options.shape === 'cuboid' ? baseRadius * 2 : undefined,
      depth: options.shape === 'cuboid' ? baseRadius * 2 : undefined,
    };

    const cake = new THREE.Group();
    cake.name = 'CakeBase';
    const layers: THREE.Mesh[] = [];
    const firstLayerCenterY = -metadata.totalHeight / 2 + layerHeight / 2;

    for (let index = 0; index < options.layers; index++) {
      const geometry =
        options.shape === 'cylinder'
          ? new THREE.CylinderGeometry(baseRadius, baseRadius, layerHeight, 64)
          : new THREE.BoxGeometry((metadata.width ?? baseRadius * 2), layerHeight, (metadata.depth ?? baseRadius * 2));

      const layer = new THREE.Mesh(geometry, material);
      layer.position.y = firstLayerCenterY + index * layerHeight;
      layer.userData['isCakeLayer'] = true;
      layers.push(layer);
      cake.add(layer);
    }

    cake.userData['metadata'] = metadata;
    cake.userData['material'] = material;
    cake.userData['layers'] = layers;

    return { cake, layers, material, metadata };
  }
}
