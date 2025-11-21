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
  glaze?: THREE.Group;
  glazeMaterial?: THREE.MeshStandardMaterial;
}

export class ThreeObjectsFactory {
  private static textureLoader = new THREE.TextureLoader();
  private static colorMap: THREE.Texture | null = null;
  private static bumpMap: THREE.Texture | null = null;
  private static roughnessMap: THREE.Texture | null = null;
  private static glazeColorMap: THREE.Texture | null = null;
  private static glazeNormalMap: THREE.Texture | null = null;

  // ========= CAKE BASE =========

  private static ensureTexturesLoaded(): void {
    if (this.colorMap && this.bumpMap && this.roughnessMap) {
      return;
    }

    this.colorMap = this.textureLoader.load('/assets/textures/cake_color.jpg');
    this.bumpMap = this.textureLoader.load('/assets/textures/cake_bump.jpg');
    this.roughnessMap = this.textureLoader.load('/assets/textures/cake_roughness.jpg');

    [this.colorMap, this.bumpMap, this.roughnessMap].forEach((texture) => {
      if (!texture) return;
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

    // podstawowe wymiary
    if (metadata.layerDimensions.length > 0) {
      const firstLayer = metadata.layerDimensions[0];
      metadata.radius = firstLayer.radius;
      metadata.width = firstLayer.width;
      metadata.depth = firstLayer.depth;

      const radii = metadata.layerDimensions
        .map((l) => l.radius)
        .filter((v): v is number => v !== undefined);
      if (radii.length > 0) {
        metadata.maxRadius = Math.max(...radii);
      }

      const widths = metadata.layerDimensions
        .map((l) => l.width)
        .filter((v): v is number => v !== undefined);
      if (widths.length > 0) {
        metadata.maxWidth = Math.max(...widths);
      }

      const depths = metadata.layerDimensions
        .map((l) => l.depth)
        .filter((v): v is number => v !== undefined);
      if (depths.length > 0) {
        metadata.maxDepth = Math.max(...depths);
      }
    }

    // ========= GLAZE =========

    const glaze = this.createGlaze(metadata, options);
    if (glaze) {
      cake.add(glaze);
    }

    cake.userData['metadata'] = metadata;
    cake.userData['material'] = material;
    cake.userData['layers'] = layers;
    cake.userData['glaze'] = glaze ?? null;

    return {
      cake,
      layers,
      material,
      metadata,
      glaze: glaze ?? undefined,
      glazeMaterial: glaze ? (glaze.userData['glazeMaterial'] as THREE.MeshStandardMaterial) : undefined,
    };
  }

  // ========= GLAZE CREATION =========

  private static createGlaze(metadata: CakeMetadata, options: CakeOptions): THREE.Group | null {
    if (!options.glaze_enabled) return null;

    const topLayer = metadata.layerDimensions[metadata.layerDimensions.length - 1];
    if (!topLayer) return null;

    // Parametry
    const thickness = THREE.MathUtils.clamp(options.glaze_thickness ?? 0.25, 0.1, 1);
    // Skracamy domyślną długość, bo prosiłeś o krótsze
    const dripLength = THREE.MathUtils.clamp(options.glaze_drip_length ?? 1.5, 0.5, 5.0);
    const glazeSeed = options.glaze_seed ?? 1;
    const random = this.createRandomGenerator(glazeSeed);
    const material = this.createGlazeMaterial(options.glaze_color ?? '#ffffff');

    const group = new THREE.Group();
    group.name = 'CakeGlaze';
    group.userData['glazeMaterial'] = material;
    group.userData['isCakeGlaze'] = true;

    if (metadata.shape === 'cuboid') {
      const cuboidGeometry = this.buildCuboidGlazeGeometry(topLayer, metadata, thickness, dripLength, random);
      if (!cuboidGeometry) return null;

      const cuboidMesh = new THREE.Mesh(cuboidGeometry, material);
      cuboidMesh.userData['isCakeGlaze'] = true;
      group.add(cuboidMesh);

      return group;
    }

    const cakeRadius = topLayer.radius ?? metadata.radius ?? 2;

    // 1. GÓRNA TAFLA (Czapa)
    // Musi wystawać poza tort (overhang), żeby sople spadały z "półki"
    const overhang = thickness * 0.1;
    const poolRadius = cakeRadius + overhang;

    const topGeo = new THREE.CylinderGeometry(poolRadius, poolRadius, thickness * 0.7, 64);
    const topMesh = new THREE.Mesh(topGeo, material);
    topMesh.userData['isCakeGlaze'] = true;
    topMesh.position.y = topLayer.topY + thickness * 0.35;
    group.add(topMesh);

    // 2. RANT (Torus) - To on tworzy zaokrągloną krawędź
    // Pogrubiamy go, żeby lepiej ukryć łączenia
    const rimThickness = thickness * 0.6;
    const rimGeo = new THREE.TorusGeometry(poolRadius - rimThickness*0.4, rimThickness, 16, 100);

    // Lekki szum na rancie (opcjonalnie)
    const pos = rimGeo.attributes['position'];
    for(let i=0; i<pos.count; i++){
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Delikatne falowanie góra-dół
      pos.setZ(i, z + Math.sin(Math.atan2(y,x)*15)*0.05*thickness);
    }
    rimGeo.computeVertexNormals();

    const rimMesh = new THREE.Mesh(rimGeo, material);
    rimMesh.userData['isCakeGlaze'] = true;
    rimMesh.rotateX(Math.PI / 2);
    rimMesh.position.y = topLayer.topY + thickness * 0.35;
    group.add(rimMesh);

    // 3. SOPLE
    // Startujemy wysoko, prawie w połowie grubości rantu
    const startY = topLayer.topY + thickness * 0.35;

    const dripsGroup = this.createRefinedDrips(
      startY,
      cakeRadius,
      material,
      thickness,
      dripLength,
      random
    );

    if (dripsGroup) {
      dripsGroup.traverse((child) => (child.userData['isCakeGlaze'] = true));
      group.add(dripsGroup);
    }

    return group;
  }

  private static createRefinedDrips(
    startY: number,
    cakeRadius: number,
    material: THREE.Material,
    baseThickness: number,
    baseLength: number,
    random: () => number,
  ): THREE.Group {
    const group = new THREE.Group();
    const twoPi = Math.PI * 2;
    let angle = 0;

    while (angle < twoPi) {
      // ZMNIEJSZONE ODSTĘPY -> WIĘCEJ SOPLI
      const gapNoise = random();
      // Gap między 0.05 a 0.15 (wcześniej było dużo szerzej)
      const gap = 0.05 + gapNoise * 0.1 + (gapNoise > 0.9 ? 0.1 : 0.0);

      // Konwersja odległości na kąt
      const angleStep = gap * (2.5 / cakeRadius);
      angle += angleStep;
      if (angle > twoPi) break;

      // Krótsze i bardziej zróżnicowane sople
      const isLong = random() > 0.4;

      // Długość: Long (0.6 - 1.0 bazy), Short (0.2 - 0.4 bazy) -> małe kropelki
      const length = isLong
        ? baseLength * (0.6 + random() * 0.4)
        : baseLength * (0.2 + random() * 0.2);

      // Cienka szyjka
      const neckThickness = baseThickness * 0.20;

      // Kształt kropli: Jeśli sopel długi, to duża kropla. Jeśli krótki, to mała.
      const bulbScale = isLong ? 1.1 : 1.2;
      const bulbSize = neckThickness * bulbScale ;

      // Geometria
      const radialSegs = 16;
      const heightSegs = Math.floor(length * 30) + 10; // Duża gęstość dla gładkości

      // openEnded: false -> zamykamy denko, żeby kropla była pełna od dołu
      const geometry = new THREE.CylinderGeometry(
        neckThickness, neckThickness, length,
        radialSegs, heightSegs,
        false
      );

      const posAttribute = geometry.attributes['position'];
      const vertexCount = posAttribute.count;

      const wobblePhase = random() * 10;

      for (let i = 0; i < vertexCount; i++) {
        const ix = i * 3;
        let x = posAttribute.getX(i);
        let y = posAttribute.getY(i);
        let z = posAttribute.getZ(i);

        // T: 0 (Góra) -> 1 (Dół)
        const t = 1.0 - ((y + length / 2) / length);

        // Normalize radial position
        const len = Math.sqrt(x*x + z*z);
        const nx = len > 0 ? x/len : 0;
        const nz = len > 0 ? z/len : 0;

        let currentRadius = neckThickness;

        // --- PROFILOWANIE GRUBOŚCI ---

        // 1. GÓRA (LEJEK) - Szerokie łączenie z rantem
        if (t < 0.15) {
          const topT = (0.15 - t) / 0.15; // 1 na samej górze
          // Bardzo szeroki kielich na górze
          currentRadius += Math.pow(topT, 2) * (baseThickness * 0.8);
        }

          // 2. DÓŁ (KROPLA)
        // Zamiast flary, robimy sferę.
        else if (t > 0.92) {
          const bulbT = (t - 0.92) / 0.08; // 0..1

          if (bulbT < 0.3) {
            // Przejście z szyjki w najszerszy punkt
            // smoothstep: od 0 do 1
            const blend = THREE.MathUtils.smoothstep(bulbT, 0, 0.3);
            currentRadius = neckThickness + (bulbSize - neckThickness) * blend;
          } else {
            // SAM DÓŁ - ZAMYKANIE PO ŁUKU
            // sphereT idzie od 0 (najszerszy punkt) do 1 (sam czubek)
            const sphereT = (bulbT - 0.3) / 0.7;

            // Wzór na koło: sqrt(1 - x^2)
            // To sprawia, że ścianki schodzą się idealnie kuliście
            const shape = Math.sqrt(Math.max(0, 1 - sphereT * sphereT));

            // Mnożymy bulbSize przez kształt.
            // Na samym końcu (sphereT=1) shape=0, więc promień=0.
            // To eliminuje płaskie denko.
            currentRadius = bulbSize * shape;
          }
        }

        // 3. SZYJKA - minimalne zwężenie
        else {
          currentRadius *= 0.9; // Lekkie wcięcie w talii
        }

        // Zastosuj promień
        x = nx * currentRadius;
        z = nz * currentRadius;

        // --- WYGIĘCIA I POZYCJA ---

        // 4. ŁĄCZENIE Z GÓRĄ ("HACZYK")
        // Wpychamy górne wierzchołki głęboko w Torus (Z+)
        if (t < 0.15) {
          const hookStrength = (0.15 - t) / 0.15;
          z += hookStrength * baseThickness * 0.6; // Do środka
          x *= (1.0 + hookStrength * 0.8); // Szerzej na boki
        }

        // 5. SPŁASZCZANIE PLECÓW (z > 0 to strona tortu w lokalnym ukł.)
        if (z > 0 && t > 0.1) {
          z *= 0.2; // Płaskie plecy
        }

        // 6. FALOWANIE (Wobble)
        const waveX = Math.sin(t * 10 + wobblePhase) * (neckThickness * 0.2);
        x += waveX;

        posAttribute.setXYZ(i, x, y, z);
      }

      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);

      // --- POZYCJONOWANIE NA ZEWNĄTRZ ---
      // FIX "Wchodzenia w tort":
      // Radius tortu + połowa grubości szyjki + mały margines bezpieczeństwa (0.02)
      const placementRadius = cakeRadius ;

      const px = Math.cos(angle) * placementRadius;
      const pz = Math.sin(angle) * placementRadius;
      const py = startY - 0.02 - length / 2;

      mesh.position.set(px, py, pz);

      // Kierujemy Z w stronę środka tortu
      mesh.lookAt(0, py, 0);

      // Losowy obrót na boki
      mesh.rotateZ((random() - 0.5) * 0.2);

      group.add(mesh);
    }

    return group;
  }
  private static createGlazeMaterial(color: string): THREE.MeshStandardMaterial {
    if (!this.glazeColorMap) {
      this.glazeColorMap = this.textureLoader.load('/assets/textures/Candy001_1K-JPG_Color.jpg');
      this.glazeNormalMap = this.textureLoader.load('/assets/textures/Candy001_1K-JPG_NormalGL.jpg');

      [this.glazeColorMap, this.glazeNormalMap].forEach((texture) => {
        if (!texture) return;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2.5, 2.5);
      });
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      // jeśli chcesz super gładką polewę, na razie bez tekstur:
      // map: this.glazeColorMap ?? undefined,
      // normalMap: this.glazeNormalMap ?? undefined,
      roughness: 0.25,
      metalness: 0.15,
      envMapIntensity: 0.8,
    });

    material.normalScale = new THREE.Vector2(0.8, 0.8);
    material.side = THREE.DoubleSide;
    return material;
  }

  // ========= OLD CUBOID GLAZE + NOISE HELPERS =========

  private static buildCuboidGlazeGeometry(
    layer: LayerMetadata,
    metadata: CakeMetadata,
    thickness: number,
    dripLength: number,
    random: () => number,
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
    const apexPositions: number[] = [];
    const crownPositions: number[] = [];
    const shoulderPositions: number[] = [];
    const flowPositions: number[] = [];
    const bellyPositions: number[] = [];
    const tipPositions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const minSize = Math.min(width, depth);
    const rimNoise = this.normalizeNoise(
      this.smoothNoise(this.buildNoiseSequence(totalSegments, 1.1, random()), 4)
    );
    const dripNoise = this.normalizeNoise(
      this.smoothNoise(this.buildNoiseSequence(totalSegments, 1.6, 0.4 + random() * 0.6, random), 5)
    );
    const dripMask = this.buildDripMask(dripNoise, 0.55, 2.25, 2);
    const domeNoise = this.normalizeNoise(
      this.smoothNoise(this.buildNoiseSequence(totalSegments, 0.95, 0.6 + random() * 0.4, random), 3)
    );
    const wobbleNoise = this.normalizeNoise(
      this.smoothNoise(this.buildNoiseSequence(totalSegments, 0.55, 0.9 + random() * 0.4, random), 3)
    );

    for (let i = 0; i < totalSegments; i++) {
      const { x, z, normal } = points[i];
      const rimProfile = 0.7 + rimNoise[i] * 0.55;
      const dripProfile = 0.18 + dripMask[i] * 1.05;
      const domeProfile = 0.64 + domeNoise[i] * 0.5;
      const wobbleProfile = 0.32 + wobbleNoise[i] * 0.7;

      const outwardDrip = minSize * (0.04 + dripProfile * 0.09);
      const inwardRelax = 0.08 + (1 - dripMask[i]) * 0.34;
      const rimRadius = outwardDrip * (0.82 + rimProfile * 0.42 - inwardRelax * 0.28);
      const flowRadius = rimRadius * 0.82 + outwardDrip * (0.46 + wobbleProfile * 0.12);
      const bellyRadius = outwardDrip + rimRadius * (0.5 + dripProfile * 0.42);
      const tipRadius = flowRadius * 0.92 + outwardDrip * (0.52 + dripProfile * 0.3);

      const apexPoint = new THREE.Vector2(x, z).multiplyScalar(0.55);
      const crownLift = thickness * (0.7 + domeProfile * 0.48);
      const apexLift = crownLift + thickness * 0.16;
      const rimYOffset = thickness * (0.48 + domeProfile * 0.2);
      const flowYOffset = thickness * (0.05 - dripProfile * 0.14 - wobbleProfile * 0.06);
      const bellyYOffset = -Math.max(dripLength, 0.02) * (0.24 + dripProfile * 0.92);
      const tipYOffset = -Math.max(dripLength, 0.02) * (0.42 + dripProfile * 1.05);

      const crownPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(rimRadius + thickness * 0.14));
      const rimPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(rimRadius));
      const flowPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(flowRadius));
      const bellyPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(bellyRadius));
      const tipPoint = new THREE.Vector2(x, z).add(normal.clone().multiplyScalar(tipRadius));

      apexPositions.push(apexPoint.x, topY + apexLift, apexPoint.y);
      crownPositions.push(crownPoint.x, topY + crownLift, crownPoint.y);
      shoulderPositions.push(rimPoint.x, topY + rimYOffset, rimPoint.y);
      flowPositions.push(flowPoint.x, topY + flowYOffset, flowPoint.y);
      bellyPositions.push(bellyPoint.x, topY + bellyYOffset, bellyPoint.y);
      tipPositions.push(tipPoint.x, topY + tipYOffset, tipPoint.y);

      const u = i / totalSegments;
      uvs.push(u, 1.1, u, 1.0, u, 0.86, u, 0.6, u, 0.28, u, 0.0);
    }

    const positions = [
      ...apexPositions,
      ...crownPositions,
      ...shoulderPositions,
      ...flowPositions,
      ...bellyPositions,
      ...tipPositions,
      0,
      topY + thickness * 0.9,
      0,
    ];
    const apexRingStart = 0;
    const crownRingStart = apexRingStart + apexPositions.length / 3;
    const rimRingStart = crownRingStart + crownPositions.length / 3;
    const flowRingStart = rimRingStart + shoulderPositions.length / 3;
    const bellyRingStart = flowRingStart + flowPositions.length / 3;
    const tipRingStart = bellyRingStart + bellyPositions.length / 3;
    const centerIndex = positions.length / 3 - 1;

    for (let i = 0; i < totalSegments; i++) {
      const next = (i + 1) % totalSegments;
      const apexCurrent = apexRingStart + i;
      const crownCurrent = crownRingStart + i;
      const rimCurrent = rimRingStart + i;
      const flowCurrent = flowRingStart + i;
      const bellyCurrent = bellyRingStart + i;
      const tipCurrent = tipRingStart + i;
      const apexNext = apexRingStart + next;
      const crownNext = crownRingStart + next;
      const rimNext = rimRingStart + next;
      const flowNext = flowRingStart + next;
      const bellyNext = bellyRingStart + next;
      const tipNext = tipRingStart + next;

      this.pushQuad(indices, centerIndex, apexNext, apexCurrent,bellyNext);
      this.pushQuad(indices, apexCurrent, apexNext, crownCurrent, crownNext);
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

  private static buildCuboidRingPoints(
    width: number,
    depth: number,
    segmentsPerSide: number,
  ): Array<{ x: number; z: number; normal: THREE.Vector2 }> {
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

  private static createRandomGenerator(seedValue: number | string): () => number {
    let seed = typeof seedValue === 'number' ? Math.floor(seedValue) : this.hashSeed(seedValue);
    seed = (seed ^ 0x6d2b79f5) >>> 0;

    return () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed ^ (seed >>> 15);
      t = Math.imul(t | 1, t);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private static hashSeed(seedText: string): number {
    return seedText.split('').reduce((acc, char, index) => {
      const code = char.charCodeAt(0) + index * 17;
      return (acc ^ (code << (index % 8))) >>> 0;
    }, 0x9e3779b9);
  }

  private static sampleNoise(value: number): number {
    const x = Math.sin(value * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  private static buildNoiseSequence(
    length: number,
    frequency: number,
    offset = 0,
    random?: () => number,
  ): number[] {
    const phaseOffset = offset + (random ? random() * 10 : 0);
    return Array.from({ length }, (_, index) => this.sampleNoise(index * frequency + phaseOffset));
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

  private static buildDripMask(values: number[], threshold: number, exponent: number, smoothing: number): number[] {
    const emphasized = values.map((value) => {
      const normalized = Math.max(0, value - threshold) / Math.max(1 - threshold, 1e-5);
      return Math.pow(normalized, exponent);
    });
    const softened = this.smoothNoise(emphasized, smoothing);
    const min = Math.min(...softened);
    const max = Math.max(...softened);
    const range = Math.max(max - min, 1e-5);
    return softened.map((value) => Math.max(0.08, (value - min) / range));
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
