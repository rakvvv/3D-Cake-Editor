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
  glaze?: THREE.Mesh;
  glazeMaterial?: THREE.MeshStandardMaterial;
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

    const glaze = this.createGlaze(metadata, options);
    if (glaze) {
      cake.add(glaze);
    }

    cake.userData['metadata'] = metadata;
    cake.userData['material'] = material;
    cake.userData['layers'] = layers;
    cake.userData['glaze'] = glaze ?? null;

    return { cake, layers, material, metadata, glaze: glaze ?? undefined, glazeMaterial: glaze?.material as THREE.MeshStandardMaterial | undefined };
  }

  private static createGlaze(metadata: CakeMetadata, options: CakeOptions): THREE.Mesh | null {
    if (!options.glaze_enabled) {
      return null;
    }

    const topLayer = metadata.layerDimensions[metadata.layerDimensions.length - 1];
    if (!topLayer) {
      return null;
    }

    const thickness = THREE.MathUtils.clamp(options.glaze_thickness ?? 0.2, 0.02, 1);
    const dripLength = THREE.MathUtils.clamp(options.glaze_drip_length ?? 0.5, 0, 2);
    const material = this.createGlazeMaterial(options.glaze_color ?? '#ffffff');

    const geometry = metadata.shape === 'cylinder'
      ? this.buildCylindricalGlazeGeometry(topLayer, metadata, thickness, dripLength)
      : this.buildCuboidGlazeGeometry(topLayer, metadata, thickness, dripLength);

    if (!geometry) {
      material.dispose();
      return null;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'CakeGlaze';
    mesh.userData['isCakeGlaze'] = true;
    return mesh;
  }

  private static createGlazeMaterial(color: string): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.25,
      metalness: 0.15,
      envMapIntensity: 0.8,
    });
    material.side = THREE.DoubleSide;
    return material;
  }

  private static buildCylindricalGlazeGeometry(
    layer: LayerMetadata,
    metadata: CakeMetadata,
    thickness: number,
    dripLength: number,
  ): THREE.BufferGeometry | null {
    const radius = layer.radius ?? metadata.radius;
    if (!radius) {
      return null;
    }

    const segments = 64;
    const topY = metadata.totalHeight / 2;
    const topPositions: number[] = [];
    const rimPositions: number[] = [];
    const dripPositions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const baseNormal = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
      const radiusNoise = (this.sampleNoise(angle * 3.1) - 0.5) * radius * 0.12;
      const dripNoise = this.sampleNoise(angle * 5.3 + 1.2);
      const rimRadius = radius + radiusNoise;
      const dripOffset = Math.max(dripLength * (0.4 + dripNoise * 0.6), 0);
      const outwardDrip = radius * 0.05 + dripNoise * radius * 0.08;

      const topRadius = rimRadius + radius * 0.05;
      const dripRadius = rimRadius + outwardDrip;

      const topX = baseNormal.x * topRadius;
      const topZ = baseNormal.y * topRadius;
      const rimX = baseNormal.x * rimRadius;
      const rimZ = baseNormal.y * rimRadius;
      const dripX = baseNormal.x * dripRadius;
      const dripZ = baseNormal.y * dripRadius;

      topPositions.push(topX, topY + thickness, topZ);
      rimPositions.push(rimX, topY, rimZ);
      dripPositions.push(dripX, topY - dripOffset, dripZ);
    }

    const positions = [...topPositions, ...rimPositions, ...dripPositions, 0, topY + thickness, 0];
    const topRingStart = 0;
    const rimRingStart = topPositions.length / 3;
    const dripRingStart = rimRingStart + rimPositions.length / 3;
    const centerIndex = positions.length / 3 - 1;

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const topCurrent = topRingStart + i;
      const topNext = topRingStart + next;
      const rimCurrent = rimRingStart + i;
      const rimNext = rimRingStart + next;
      const dripCurrent = dripRingStart + i;
      const dripNext = dripRingStart + next;

      // top cap
      indices.push(centerIndex, topNext, topCurrent);

      // thickness walls
      indices.push(topCurrent, rimCurrent, rimNext);
      indices.push(topCurrent, rimNext, topNext);

      // drip walls
      indices.push(rimCurrent, dripCurrent, dripNext);
      indices.push(rimCurrent, dripNext, rimNext);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private static buildCuboidGlazeGeometry(
    layer: LayerMetadata,
    metadata: CakeMetadata,
    thickness: number,
    dripLength: number,
  ): THREE.BufferGeometry | null {
    const width = layer.width ?? metadata.width;
    const depth = layer.depth ?? metadata.depth;
    if (!width || !depth) {
      return null;
    }

    const segmentsPerSide = 16;
    const points = this.buildCuboidRingPoints(width, depth, segmentsPerSide);
    const totalSegments = points.length;
    const topY = metadata.totalHeight / 2;
    const topPositions: number[] = [];
    const rimPositions: number[] = [];
    const dripPositions: number[] = [];
    const indices: number[] = [];
    const dripMagnitude = Math.min(width, depth) * 0.15;

    for (let i = 0; i < totalSegments; i++) {
      const { x, z, normal, noiseBasis } = points[i];
      const noise = this.sampleNoise(noiseBasis);
      const offset = (noise - 0.5) * Math.min(width, depth) * 0.08;
      const dripNoise = this.sampleNoise(noiseBasis * 1.73 + 0.5);
      const dripAmount = Math.max(dripLength * (0.4 + dripNoise * 0.6), 0);
      const outward = dripMagnitude * (0.3 + dripNoise * 0.7);

      const topX = x + normal.x * (offset + 0.05 * Math.sign(normal.x));
      const topZ = z + normal.y * (offset + 0.05 * Math.sign(normal.y));
      const rimX = x + normal.x * offset;
      const rimZ = z + normal.y * offset;
      const dripX = x + normal.x * (offset * 0.5 + outward);
      const dripZ = z + normal.y * (offset * 0.5 + outward);

      topPositions.push(topX, topY + thickness, topZ);
      rimPositions.push(rimX, topY, rimZ);
      dripPositions.push(dripX, topY - dripAmount, dripZ);
    }

    const positions = [...topPositions, ...rimPositions, ...dripPositions, 0, topY + thickness, 0];
    const topRingStart = 0;
    const rimRingStart = topPositions.length / 3;
    const dripRingStart = rimRingStart + rimPositions.length / 3;
    const centerIndex = positions.length / 3 - 1;

    for (let i = 0; i < totalSegments; i++) {
      const next = (i + 1) % totalSegments;
      const topCurrent = topRingStart + i;
      const rimCurrent = rimRingStart + i;
      const dripCurrent = dripRingStart + i;
      const topNext = topRingStart + next;
      const rimNext = rimRingStart + next;
      const dripNext = dripRingStart + next;

      indices.push(centerIndex, topNext, topCurrent);
      indices.push(topCurrent, rimCurrent, rimNext);
      indices.push(topCurrent, rimNext, topNext);
      indices.push(rimCurrent, dripCurrent, dripNext);
      indices.push(rimCurrent, dripNext, rimNext);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private static buildCuboidRingPoints(width: number, depth: number, segmentsPerSide: number): Array<{
    x: number;
    z: number;
    normal: THREE.Vector2;
    noiseBasis: number;
  }> {
    const hx = width / 2;
    const hz = depth / 2;
    const points: Array<{ x: number; z: number; normal: THREE.Vector2; noiseBasis: number }> = [];
    const sides: Array<{
      start: THREE.Vector2;
      end: THREE.Vector2;
      normal: THREE.Vector2;
    }> = [
      { start: new THREE.Vector2(-hx, hz), end: new THREE.Vector2(hx, hz), normal: new THREE.Vector2(0, 1) },
      { start: new THREE.Vector2(hx, hz), end: new THREE.Vector2(hx, -hz), normal: new THREE.Vector2(1, 0) },
      { start: new THREE.Vector2(hx, -hz), end: new THREE.Vector2(-hx, -hz), normal: new THREE.Vector2(0, -1) },
      { start: new THREE.Vector2(-hx, -hz), end: new THREE.Vector2(-hx, hz), normal: new THREE.Vector2(-1, 0) },
    ];

    sides.forEach((side, sideIndex) => {
      for (let step = 0; step < segmentsPerSide; step++) {
        const t = (step + 0.5) / segmentsPerSide;
        const point = new THREE.Vector2().copy(side.end).sub(side.start).multiplyScalar(t).add(side.start);
        points.push({
          x: point.x,
          z: point.y,
          normal: side.normal.clone(),
          noiseBasis: sideIndex * segmentsPerSide + step,
        });
      }
    });

    return points;
  }

  private static sampleNoise(value: number): number {
    const x = Math.sin(value * 12.9898) * 43758.5453;
    return x - Math.floor(x);
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
