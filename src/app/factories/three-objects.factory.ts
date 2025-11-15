import * as THREE from 'three';
import { CakeOptions } from '../models/cake.options';

export interface LayerMetadata {
  index: number;
  size: number;
  height: number;
  topY: number;
  bottomY: number;
  radius?: number;
  width?: number;
  depth?: number;
}

export interface CakeMetadata {
  shape: CakeOptions['shape'];
  layers: number;
  layerHeight: number;
  totalHeight: number;
  layerSizes: number[];
  layerDimensions: LayerMetadata[];
  radius?: number;
  width?: number;
  depth?: number;
  maxRadius?: number;
  maxWidth?: number;
  maxDepth?: number;
}

export interface CakeCreationResult {
  cake: THREE.Group;
  layers: THREE.Mesh[];
  material: THREE.MeshStandardMaterial;
  metadata: CakeMetadata;
}

export class ThreeObjectsFactory {
  private static frostingCache = new Map<string, THREE.Texture>();

  private static createCakeMaterial(color: string): THREE.MeshStandardMaterial {
    const frostingTexture = this.getFrostingTexture(color);
    const highlightColor = new THREE.Color(color).lerp(new THREE.Color('#fff7fb'), 0.35);
    const material = new THREE.MeshStandardMaterial({
      map: frostingTexture,
      bumpMap: frostingTexture,
      bumpScale: 0.05,
      roughnessMap: frostingTexture,
      roughness: 0.4,
      metalness: 0.05,
    });

    material.color.copy(highlightColor);
    material.emissive.copy(new THREE.Color(color).multiplyScalar(0.12));
    material.emissiveIntensity = 0.4;
    return material;
  }

  private static getFrostingTexture(color: string): THREE.Texture {
    const key = color.toLowerCase();
    const cached = this.frostingCache.get(key);
    if (cached) {
      return cached;
    }

    const tint = new THREE.Color(color);
    const texture = typeof document !== 'undefined'
      ? this.createCanvasFrostingTexture(tint)
      : this.createDataFrostingTexture(tint);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.4, 0.9);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.frostingCache.set(key, texture);
    return texture;
  }

  private static createCanvasFrostingTexture(color: THREE.Color): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas rendering context not available.');
    }

    const pastel = color.clone().lerp(new THREE.Color('#fff5f9'), 0.65);
    context.fillStyle = `#${pastel.getHexString()}`;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const accent = color.clone().lerp(new THREE.Color('#ffd4ec'), 0.4);
    context.strokeStyle = `rgba(${Math.round(accent.r * 255)}, ${Math.round(accent.g * 255)}, ${Math.round(accent.b * 255)}, 0.35)`;
    context.lineWidth = 14;
    for (let ring = 0; ring < 5; ring++) {
      context.beginPath();
      const radius = 30 + ring * 18;
      context.arc(canvas.width / 2, canvas.height / 2, radius, ring * 0.7, Math.PI * 2);
      context.stroke();
    }

    const sprinkleColors = [
      accent.clone().lerp(new THREE.Color('#ffffff'), 0.6),
      accent.clone().lerp(new THREE.Color('#ffd4a3'), 0.5),
      accent.clone().lerp(new THREE.Color('#c8ffe0'), 0.4),
    ];
    for (let sprinkle = 0; sprinkle < 70; sprinkle++) {
      const angle = (sprinkle * 137.5 * Math.PI) / 180;
      const radius = 50 + (sprinkle % 40);
      const x = canvas.width / 2 + Math.cos(angle) * radius;
      const y = canvas.height / 2 + Math.sin(angle * 0.8) * radius * 0.6;
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      const sprinkleColor = sprinkleColors[sprinkle % sprinkleColors.length];
      context.fillStyle = `#${sprinkleColor.getHexString()}`;
      context.fillRect(-2, -6, 4, 12);
      context.restore();
    }

    return new THREE.CanvasTexture(canvas);
  }

  private static createDataFrostingTexture(color: THREE.Color): THREE.DataTexture {
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    const pastel = color.clone().lerp(new THREE.Color('#fff7fa'), 0.6);
    const accent = color.clone().lerp(new THREE.Color('#ffd6ed'), 0.35);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size - 0.5;
        const v = y / size - 0.5;
        const angle = Math.atan2(v, u);
        const radial = Math.sqrt(u * u + v * v);
        const swirl = Math.sin(angle * 6 + radial * 18);
        const mix = 0.5 + swirl * 0.25;
        const colorMix = pastel.clone().lerp(accent, mix);
        const index = (y * size + x) * 4;
        data[index] = Math.round(colorMix.r * 255);
        data[index + 1] = Math.round(colorMix.g * 255);
        data[index + 2] = Math.round(colorMix.b * 255);
        data[index + 3] = 255;
      }
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  public static createCake(options: CakeOptions): CakeCreationResult {
    const layerHeight = 2;
    const baseRadius = 2;
    const layerSizes = this.normalizeLayerSizes(options.layers, options.layerSizes);
    const material = this.createCakeMaterial(options.cake_color);

    const metadata: CakeMetadata = {
      shape: options.shape,
      layers: options.layers,
      layerHeight,
      totalHeight: layerHeight * options.layers,
      layerSizes,
      layerDimensions: [],
    };

    const cake = new THREE.Group();
    cake.name = 'CakeBase';
    const layers: THREE.Mesh[] = [];
    const firstLayerCenterY = -metadata.totalHeight / 2 + layerHeight / 2;

    for (let index = 0; index < options.layers; index++) {
      const sizeMultiplier = layerSizes[index] ?? 1;
      const bottomY = -metadata.totalHeight / 2 + index * layerHeight;
      const topY = bottomY + layerHeight;

      let geometry: THREE.BufferGeometry;
      let radius: number | undefined;
      let width: number | undefined;
      let depth: number | undefined;

      if (options.shape === 'cylinder') {
        radius = baseRadius * sizeMultiplier;
        geometry = new THREE.CylinderGeometry(radius, radius, layerHeight, 64);
      } else {
        width = baseRadius * 2 * sizeMultiplier;
        depth = baseRadius * 2 * sizeMultiplier;
        geometry = new THREE.BoxGeometry(width, layerHeight, depth);
      }

      const layer = new THREE.Mesh(geometry, material);
      layer.position.y = firstLayerCenterY + index * layerHeight;
      layer.userData['isCakeLayer'] = true;
      layers.push(layer);
      cake.add(layer);

      metadata.layerDimensions.push({
        index,
        size: sizeMultiplier,
        height: layerHeight,
        topY,
        bottomY,
        radius,
        width,
        depth,
      });
    }

    if (metadata.layerDimensions.length > 0) {
      const firstLayer = metadata.layerDimensions[0];
      metadata.radius = firstLayer.radius;
      metadata.width = firstLayer.width;
      metadata.depth = firstLayer.depth;

      const radii = metadata.layerDimensions
        .map((layer) => layer.radius)
        .filter((value): value is number => value !== undefined);
      if (radii.length > 0) {
        metadata.maxRadius = Math.max(...radii);
      }

      const widths = metadata.layerDimensions
        .map((layer) => layer.width)
        .filter((value): value is number => value !== undefined);
      if (widths.length > 0) {
        metadata.maxWidth = Math.max(...widths);
      }

      const depths = metadata.layerDimensions
        .map((layer) => layer.depth)
        .filter((value): value is number => value !== undefined);
      if (depths.length > 0) {
        metadata.maxDepth = Math.max(...depths);
      }
    }

    cake.userData['metadata'] = metadata;
    cake.userData['material'] = material;
    cake.userData['layers'] = layers;

    return { cake, layers, material, metadata };
  }

  private static normalizeLayerSizes(targetLayers: number, provided: number[] | undefined): number[] {
    const result: number[] = [];
    const source = provided ?? [];
    const minSize = 0.6;
    const maxSize = 1.5;

    for (let index = 0; index < targetLayers; index++) {
      const fallback = index === 0 ? 1 : result[index - 1];
      let value = Number(source[index] ?? fallback);
      value = THREE.MathUtils.clamp(value, minSize, maxSize);
      if (index > 0) {
        value = Math.min(value, result[index - 1]);
      }
      result.push(value);
    }

    return result;
  }
}
