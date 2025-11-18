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
  private static glazeColorMap: THREE.Texture | null = null;
  private static glazeNormalMap: THREE.Texture | null = null;

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
    if (!this.glazeColorMap) {
      this.glazeColorMap = this.textureLoader.load('/assets/textures/Candy001_1K-JPG_Color.jpg');
      this.glazeNormalMap = this.textureLoader.load('/assets/textures/Candy001_1K-JPG_NormalGL.jpg');

      [this.glazeColorMap, this.glazeNormalMap].forEach((texture) => {
        if (!texture) {
          return;
        }
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2.5, 2.5);
      });
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      map: this.glazeColorMap ?? undefined,
      normalMap: this.glazeNormalMap ?? undefined,
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

    const segments = 128;
    const topY = metadata.totalHeight / 2;
    const topPositions: number[] = [];
    const rimPositions: number[] = [];
    const skirtPositions: number[] = [];
    const dripPositions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const rimNoise = this.smoothNoise(this.buildNoiseSequence(segments, 2.8), 3);
    const dripNoise = this.smoothNoise(this.buildNoiseSequence(segments, 4.2, 0.7), 3);
    const thicknessNoise = this.smoothNoise(this.buildNoiseSequence(segments, 5.1, 1.3), 2);

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const baseNormal = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
      const rimRadiusOffset = (rimNoise[i] - 0.5) * radius * 0.045 + radius * 0.03;
      const rimRadius = Math.max(radius + radius * 0.018, radius + rimRadiusOffset);
      const dripProfile = dripNoise[i];
      const dripOffset = Math.max(dripLength * (0.28 + dripProfile * 0.7), 0);
      const outwardDrip = radius * (0.035 + dripProfile * 0.06);
      const crownExtra = thicknessNoise[i] * radius * 0.018;

      const eased = 0.5 - 0.5 * Math.cos((i / segments) * Math.PI * 2);
      const topRadius = rimRadius + radius * 0.018 + crownExtra + eased * radius * 0.008;
      const skirtRadius = rimRadius + outwardDrip * 0.42;
      const dripRadius = rimRadius + outwardDrip;

      const domeLift = thickness * 0.2;
      const topYOffset = thickness * (0.92 + thicknessNoise[i] * 0.12) + domeLift;
      const rimYOffset = Math.min(topYOffset * 0.55, 0.12);
      const skirtYOffset = Math.min(thickness * 0.14, 0.04);

      const topX = baseNormal.x * topRadius;
      const topZ = baseNormal.y * topRadius;
      const rimX = baseNormal.x * rimRadius;
      const rimZ = baseNormal.y * rimRadius;
      const skirtX = baseNormal.x * skirtRadius;
      const skirtZ = baseNormal.y * skirtRadius;
      const dripX = baseNormal.x * dripRadius;
      const dripZ = baseNormal.y * dripRadius;

      topPositions.push(topX, topY + topYOffset, topZ);
      rimPositions.push(rimX, topY + rimYOffset, rimZ);
      skirtPositions.push(skirtX, topY - skirtYOffset, skirtZ);
      dripPositions.push(dripX, topY - dripOffset, dripZ);

      const u = i / segments;
      uvs.push(u, 1.0, u, 0.82, u, 0.52, u, 0.0);
    }

    const positions = [
      ...topPositions,
      ...rimPositions,
      ...skirtPositions,
      ...dripPositions,
      0,
      topY + thickness,
      0,
    ];
    const topRingStart = 0;
    const rimRingStart = topPositions.length / 3;
    const skirtRingStart = rimRingStart + rimPositions.length / 3;
    const dripRingStart = skirtRingStart + skirtPositions.length / 3;
    const centerIndex = positions.length / 3 - 1;

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const topCurrent = topRingStart + i;
      const topNext = topRingStart + next;
      const rimCurrent = rimRingStart + i;
      const rimNext = rimRingStart + next;
      const skirtCurrent = skirtRingStart + i;
      const skirtNext = skirtRingStart + next;
      const dripCurrent = dripRingStart + i;
      const dripNext = dripRingStart + next;

      indices.push(centerIndex, topNext, topCurrent);
      this.pushQuad(indices, topCurrent, topNext, rimCurrent, rimNext);
      this.pushQuad(indices, rimCurrent, rimNext, skirtCurrent, skirtNext);
      this.pushQuad(indices, skirtCurrent, skirtNext, dripCurrent, dripNext);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...uvs, 0.5, 0.5], 2));
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

    const segmentsPerSide = 20;
    const points = this.buildCuboidRingPoints(width, depth, segmentsPerSide);
    const totalSegments = points.length;
    const topY = metadata.totalHeight / 2;
    const topPositions: number[] = [];
    const rimPositions: number[] = [];
    const skirtPositions: number[] = [];
    const dripPositions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const minSize = Math.min(width, depth);
    const rimNoise = this.smoothNoise(this.buildNoiseSequence(totalSegments, 1.5), 3);
    const dripNoise = this.smoothNoise(this.buildNoiseSequence(totalSegments, 2.3, 0.4), 3);

    for (let i = 0; i < totalSegments; i++) {
      const { x, z, normal } = points[i];
      const rimOffset = (rimNoise[i] - 0.5) * minSize * 0.04;
      const outward = minSize * (0.045 + dripNoise[i] * 0.09);
      const dripAmount = Math.max(dripLength * (0.32 + dripNoise[i] * 0.7), 0);

      const topOffset = rimOffset + minSize * 0.05;
      const skirtOffset = rimOffset + outward * 0.42;
      const dripOffset = rimOffset + outward;

      const topX = x + normal.x * topOffset;
      const topZ = z + normal.y * topOffset;
      const rimX = x + normal.x * rimOffset;
      const rimZ = z + normal.y * rimOffset;
      const skirtX = x + normal.x * skirtOffset;
      const skirtZ = z + normal.y * skirtOffset;
      const dripX = x + normal.x * dripOffset;
      const dripZ = z + normal.y * dripOffset;

      const topYOffset = thickness * 0.95 + minSize * 0.01;
      const rimYOffset = Math.min(thickness * 0.55, 0.1);
      const skirtYOffset = Math.min(thickness * 0.18, 0.04);

      topPositions.push(topX, topY + topYOffset, topZ);
      rimPositions.push(rimX, topY + rimYOffset, rimZ);
      skirtPositions.push(skirtX, topY - skirtYOffset, skirtZ);
      dripPositions.push(dripX, topY - dripAmount, dripZ);

      const u = i / totalSegments;
      uvs.push(u, 1.0, u, 0.82, u, 0.52, u, 0.0);
    }

    const positions = [
      ...topPositions,
      ...rimPositions,
      ...skirtPositions,
      ...dripPositions,
      0,
      topY + thickness,
      0,
    ];
    const topRingStart = 0;
    const rimRingStart = topPositions.length / 3;
    const skirtRingStart = rimRingStart + rimPositions.length / 3;
    const dripRingStart = skirtRingStart + skirtPositions.length / 3;
    const centerIndex = positions.length / 3 - 1;

    for (let i = 0; i < totalSegments; i++) {
      const next = (i + 1) % totalSegments;
      const topCurrent = topRingStart + i;
      const rimCurrent = rimRingStart + i;
      const skirtCurrent = skirtRingStart + i;
      const dripCurrent = dripRingStart + i;
      const topNext = topRingStart + next;
      const rimNext = rimRingStart + next;
      const skirtNext = skirtRingStart + next;
      const dripNext = dripRingStart + next;

      indices.push(centerIndex, topNext, topCurrent);
      this.pushQuad(indices, topCurrent, topNext, rimCurrent, rimNext);
      this.pushQuad(indices, rimCurrent, rimNext, skirtCurrent, skirtNext);
      this.pushQuad(indices, skirtCurrent, skirtNext, dripCurrent, dripNext);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([...uvs, 0.5, 0.5], 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private static buildCuboidRingPoints(width: number, depth: number, segmentsPerSide: number): Array<{
    x: number;
    z: number;
    normal: THREE.Vector2;
  }> {
    const hx = width / 2;
    const hz = depth / 2;
    const points: Array<{ x: number; z: number; normal: THREE.Vector2 }> = [];
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

    sides.forEach((side) => {
      for (let step = 0; step < segmentsPerSide; step++) {
        const t = (step + 0.5) / segmentsPerSide;
        const point = new THREE.Vector2().copy(side.end).sub(side.start).multiplyScalar(t).add(side.start);
        points.push({
          x: point.x,
          z: point.y,
          normal: side.normal.clone(),
        });
      }
    });

    return points;
  }

  private static sampleNoise(value: number): number {
    const x = Math.sin(value * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  private static buildNoiseSequence(length: number, frequency: number, offset = 0): number[] {
    return Array.from({ length }, (_, index) => this.sampleNoise(index * frequency + offset));
  }

  private static smoothNoise(values: number[], passes: number): number[] {
    let current = [...values];
    const total = values.length;
    for (let pass = 0; pass < passes; pass++) {
      const next = new Array(total).fill(0);
      for (let index = 0; index < total; index++) {
        const prev = current[(index - 1 + total) % total];
        const nextValue = current[(index + 1) % total];
        next[index] = (prev + current[index] + nextValue) / 3;
      }
      current = next;
    }
    return current;
  }

  private static pushQuad(indices: number[], aCurrent: number, aNext: number, bCurrent: number, bNext: number): void {
    indices.push(aCurrent, bCurrent, bNext);
    indices.push(aCurrent, bNext, aNext);
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
