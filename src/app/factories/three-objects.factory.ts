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

    const segments = 180;
    const topY = metadata.totalHeight / 2;
    const crownPositions: number[] = [];
    const shoulderPositions: number[] = [];
    const flowPositions: number[] = [];
    const bellyPositions: number[] = [];
    const tipPositions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const rimNoise = this.normalizeNoise(this.smoothNoise(this.buildNoiseSequence(segments, 2.2), 4));
    const dripNoise = this.normalizeNoise(this.smoothNoise(this.buildNoiseSequence(segments, 1.6, 0.7), 5));
    const domeNoise = this.normalizeNoise(this.smoothNoise(this.buildNoiseSequence(segments, 1.1, 0.2), 3));
    const wobbleNoise = this.normalizeNoise(this.smoothNoise(this.buildNoiseSequence(segments, 0.6, 1.1), 3));

    const easedDripLength = Math.max(dripLength, 0.02);

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const baseNormal = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
      const rimProfile = 0.75 + rimNoise[i] * 0.45;
      const dripProfile = 0.35 + Math.pow(dripNoise[i], 1.2) * 0.9;
      const domeProfile = 0.7 + domeNoise[i] * 0.35;
      const wobbleProfile = 0.4 + wobbleNoise[i] * 0.6;

      const rimRadius = radius + thickness * (0.45 + rimProfile * 0.35);
      const crownRadius = rimRadius + thickness * (0.12 + rimProfile * 0.15);
      const flowRadius = rimRadius + thickness * (0.25 + dripProfile * 0.4) + radius * 0.015 * dripProfile;
      const bellyRadius = flowRadius + thickness * (0.35 + dripProfile * 0.55) + radius * 0.022 * dripProfile;
      const tipRadius = flowRadius + thickness * (0.22 + dripProfile * 0.3) + radius * 0.012 * dripProfile;

      const crownYOffset = thickness * (0.82 + domeProfile * 0.35);
      const shoulderYOffset = thickness * (0.52 + domeProfile * 0.2);
      const flowYOffset = thickness * (0.08 - dripProfile * 0.12 - wobbleProfile * 0.04);
      const bellyYOffset = -easedDripLength * (0.35 + dripProfile * 0.55);
      const tipYOffset = -easedDripLength * (0.55 + dripProfile * 0.75);

      const crownX = baseNormal.x * crownRadius;
      const crownZ = baseNormal.y * crownRadius;
      const rimX = baseNormal.x * rimRadius;
      const rimZ = baseNormal.y * rimRadius;
      const flowX = baseNormal.x * flowRadius;
      const flowZ = baseNormal.y * flowRadius;
      const bellyX = baseNormal.x * bellyRadius;
      const bellyZ = baseNormal.y * bellyRadius;
      const tipX = baseNormal.x * tipRadius;
      const tipZ = baseNormal.y * tipRadius;

      crownPositions.push(crownX, topY + crownYOffset, crownZ);
      shoulderPositions.push(rimX, topY + shoulderYOffset, rimZ);
      flowPositions.push(flowX, topY + flowYOffset, flowZ);
      bellyPositions.push(bellyX, topY + bellyYOffset, bellyZ);
      tipPositions.push(tipX, topY + tipYOffset, tipZ);

      const u = i / segments;
      uvs.push(u, 1.0, u, 0.86, u, 0.6, u, 0.28, u, 0.0);
    }

    const positions = [
      ...crownPositions,
      ...shoulderPositions,
      ...flowPositions,
      ...bellyPositions,
      ...tipPositions,
      0,
      topY + thickness * 0.95,
      0,
    ];
    const crownRingStart = 0;
    const shoulderRingStart = crownPositions.length / 3;
    const flowRingStart = shoulderRingStart + shoulderPositions.length / 3;
    const bellyRingStart = flowRingStart + flowPositions.length / 3;
    const tipRingStart = bellyRingStart + bellyPositions.length / 3;
    const centerIndex = positions.length / 3 - 1;

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const crownCurrent = crownRingStart + i;
      const shoulderCurrent = shoulderRingStart + i;
      const flowCurrent = flowRingStart + i;
      const bellyCurrent = bellyRingStart + i;
      const tipCurrent = tipRingStart + i;
      const crownNext = crownRingStart + next;
      const shoulderNext = shoulderRingStart + next;
      const flowNext = flowRingStart + next;
      const bellyNext = bellyRingStart + next;
      const tipNext = tipRingStart + next;

      indices.push(centerIndex, crownNext, crownCurrent);
      this.pushQuad(indices, crownCurrent, crownNext, shoulderCurrent, shoulderNext);
      this.pushQuad(indices, shoulderCurrent, shoulderNext, flowCurrent, flowNext);
      this.pushQuad(indices, flowCurrent, flowNext, bellyCurrent, bellyNext);
      this.pushQuad(indices, bellyCurrent, bellyNext, tipCurrent, tipNext);
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

    const segmentsPerSide = 28;
    const points = this.buildCuboidRingPoints(width, depth, segmentsPerSide);
    const totalSegments = points.length;
    const topY = metadata.totalHeight / 2;
    const crownPositions: number[] = [];
    const shoulderPositions: number[] = [];
    const flowPositions: number[] = [];
    const bellyPositions: number[] = [];
    const tipPositions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const minSize = Math.min(width, depth);
    const rimNoise = this.normalizeNoise(this.smoothNoise(this.buildNoiseSequence(totalSegments, 1.1), 4));
    const dripNoise = this.normalizeNoise(this.smoothNoise(this.buildNoiseSequence(totalSegments, 1.6, 0.4), 5));
    const domeNoise = this.normalizeNoise(this.smoothNoise(this.buildNoiseSequence(totalSegments, 0.95, 0.6), 3));
    const wobbleNoise = this.normalizeNoise(this.smoothNoise(this.buildNoiseSequence(totalSegments, 0.55, 0.9), 3));

    for (let i = 0; i < totalSegments; i++) {
      const { x, z, normal } = points[i];
      const rimProfile = 0.72 + rimNoise[i] * 0.5;
      const dripProfile = 0.35 + Math.pow(dripNoise[i], 1.15) * 0.95;
      const domeProfile = 0.65 + domeNoise[i] * 0.45;
      const wobbleProfile = 0.35 + wobbleNoise[i] * 0.65;

      const outwardDrip = minSize * (0.045 + dripProfile * 0.08);
      const rimRadius = outwardDrip * (0.85 + rimProfile * 0.4);
      const flowRadius = rimRadius * 0.85 + outwardDrip * (0.45 + wobbleProfile * 0.1);
      const bellyRadius = outwardDrip + rimRadius * (0.55 + dripProfile * 0.35);
      const tipRadius = flowRadius * 0.9 + outwardDrip * (0.5 + dripProfile * 0.25);

      const crownLift = thickness * (0.64 + domeProfile * 0.46);
      const rimYOffset = thickness * (0.48 + domeProfile * 0.18);
      const flowYOffset = thickness * (0.08 - dripProfile * 0.12 - wobbleProfile * 0.05);
      const bellyYOffset = -Math.max(dripLength, 0.02) * (0.38 + dripProfile * 0.6);
      const tipYOffset = -Math.max(dripLength, 0.02) * (0.58 + dripProfile * 0.78);

      const crownPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(rimRadius + thickness * 0.12));
      const rimPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(rimRadius));
      const flowPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(flowRadius));
      const bellyPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(bellyRadius));
      const tipPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(tipRadius));

      crownPositions.push(crownPoint.x, topY + crownLift, crownPoint.y);
      shoulderPositions.push(rimPoint.x, topY + rimYOffset, rimPoint.y);
      flowPositions.push(flowPoint.x, topY + flowYOffset, flowPoint.y);
      bellyPositions.push(bellyPoint.x, topY + bellyYOffset, bellyPoint.y);
      tipPositions.push(tipPoint.x, topY + tipYOffset, tipPoint.y);

      const u = i / totalSegments;
      uvs.push(u, 1.0, u, 0.86, u, 0.6, u, 0.28, u, 0.0);
    }

    const positions = [
      ...crownPositions,
      ...shoulderPositions,
      ...flowPositions,
      ...bellyPositions,
      ...tipPositions,
      0,
      topY + thickness * 0.9,
      0,
    ];
    const crownRingStart = 0;
    const rimRingStart = crownPositions.length / 3;
    const flowRingStart = rimRingStart + shoulderPositions.length / 3;
    const bellyRingStart = flowRingStart + flowPositions.length / 3;
    const tipRingStart = bellyRingStart + bellyPositions.length / 3;
    const centerIndex = positions.length / 3 - 1;

    for (let i = 0; i < totalSegments; i++) {
      const next = (i + 1) % totalSegments;
      const crownCurrent = crownRingStart + i;
      const rimCurrent = rimRingStart + i;
      const flowCurrent = flowRingStart + i;
      const bellyCurrent = bellyRingStart + i;
      const tipCurrent = tipRingStart + i;
      const crownNext = crownRingStart + next;
      const rimNext = rimRingStart + next;
      const flowNext = flowRingStart + next;
      const bellyNext = bellyRingStart + next;
      const tipNext = tipRingStart + next;

      indices.push(centerIndex, crownNext, crownCurrent);
      this.pushQuad(indices, crownCurrent, crownNext, rimCurrent, rimNext);
      this.pushQuad(indices, rimCurrent, rimNext, flowCurrent, flowNext);
      this.pushQuad(indices, flowCurrent, flowNext, bellyCurrent, bellyNext);
      this.pushQuad(indices, bellyCurrent, bellyNext, tipCurrent, tipNext);
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

  private static normalizeNoise(values: number[]): number[] {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1e-5);
    return values.map((value) => (value - min) / range);
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
