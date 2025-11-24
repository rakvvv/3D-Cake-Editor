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
  wafer?: THREE.Mesh;
  waferMaterial?: THREE.MeshPhysicalMaterial;
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

  private static createWaferDetailTexture(): THREE.DataTexture {
    const size = 128;
    const data = new Uint8Array(size * size * 3);

    for (let i = 0; i < data.length; i += 3) {
      const noise = 110 + Math.random() * 60;
      data[i] = noise;
      data[i + 1] = noise;
      data[i + 2] = noise;
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
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

    const wafer = this.createWafer(metadata, options);

    // ========= GLAZE =========

    const glaze = this.createGlaze(metadata, options);
    if (glaze) {
      cake.add(glaze);
    }

    if (wafer) {
      cake.add(wafer);
    }

    cake.userData['metadata'] = metadata;
    cake.userData['material'] = material;
    cake.userData['layers'] = layers;
    cake.userData['glaze'] = glaze ?? null;
    cake.userData['wafer'] = wafer ?? null;

    return {
      cake,
      layers,
      material,
      metadata,
      glaze: glaze ?? undefined,
      glazeMaterial: glaze ? (glaze.userData['glazeMaterial'] as THREE.MeshStandardMaterial) : undefined,
      wafer: wafer ?? undefined,
      waferMaterial: wafer ? (wafer.userData['waferMaterial'] as THREE.MeshPhysicalMaterial) : undefined,
    };
  }

  private static createWafer(metadata: CakeMetadata, options: CakeOptions): THREE.Mesh | null {
    if (!options.wafer_texture_url) {
      return null;
    }

    const topLayer = metadata.layerDimensions[metadata.layerDimensions.length - 1];
    if (!topLayer) {
      return null;
    }

    const texture = this.textureLoader.load(options.wafer_texture_url);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    const detailTexture = this.createWaferDetailTexture();

    const zoom = THREE.MathUtils.clamp(options.wafer_texture_zoom ?? 1, 1, 5);
    const offsetX = THREE.MathUtils.clamp(options.wafer_texture_offset_x ?? 0, -1, 1);
    const offsetY = THREE.MathUtils.clamp(options.wafer_texture_offset_y ?? 0, -1, 1);
    const repeat = 1 / zoom;
    const baseOffset = 0.5 - repeat / 2;
    texture.center.set(0.5, 0.5);
    texture.repeat.set(repeat, repeat);
    texture.offset.set(baseOffset + offsetX * repeat, baseOffset + offsetY * repeat);
    texture.needsUpdate = true;

    const material = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughnessMap: detailTexture,
      bumpMap: detailTexture,
      transparent: true,
      opacity: 1,
      alphaTest: 0.01,
      side: THREE.DoubleSide,
      roughness: 0.42,
      bumpScale: 0.12,
      metalness: 0.12,
      envMapIntensity: 0.9,
      reflectivity: 0.35,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
    });

    const scale = THREE.MathUtils.clamp(options.wafer_scale ?? 1, 0.4, 2.5);
    let geometry: THREE.BufferGeometry;

    if (metadata.shape === 'cylinder') {
      const radius = (topLayer.radius ?? metadata.radius ?? 2) * scale;
      geometry = new THREE.CircleGeometry(radius, 64);
    } else {
      const width = (topLayer.width ?? metadata.width ?? 2) * scale;
      const depth = (topLayer.depth ?? metadata.depth ?? 2) * scale;
      geometry = new THREE.PlaneGeometry(width, depth);
    }

    const wafer = new THREE.Mesh(geometry, material);
    wafer.name = 'CakeWafer';
    wafer.userData['isCakeWafer'] = true;
    wafer.userData['waferMaterial'] = material;
    wafer.userData['waferTexture'] = texture;
    wafer.userData['waferDetailTexture'] = detailTexture;
    wafer.rotation.x = -Math.PI / 2;
    wafer.position.y = topLayer.topY + 0.05;
    wafer.renderOrder = 2;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -0.1;

    const sugarMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#fff8ec'),
      transparent: true,
      opacity: 0.65,
      transmission: 0.45,
      thickness: 0.6,
      ior: 1.28,
      roughnessMap: detailTexture,
      bumpMap: detailTexture,
      bumpScale: 0.06,
      roughness: 0.2,
      metalness: 0,
      envMapIntensity: 1.2,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      reflectivity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const sugar = new THREE.Mesh(geometry.clone(), sugarMaterial);
    sugar.name = 'CakeWaferSugar';
    sugar.position.y = 0.02;
    sugar.renderOrder = 3;
    sugar.userData['waferSugarMaterial'] = sugarMaterial;
    wafer.add(sugar);

    return wafer;
  }

  // ========= GLAZE CREATION =========

  private static createGlaze(metadata: CakeMetadata, options: CakeOptions): THREE.Group | null {
    if (!options.glaze_enabled) return null;

    const topLayer = metadata.layerDimensions[metadata.layerDimensions.length - 1];
    if (!topLayer) return null;

    // Parametry
    const thickness = THREE.MathUtils.clamp(options.glaze_thickness ?? 0.15, 0.1, 1);
    // Skracamy domyślną długość, bo prosiłeś o krótsze
    const dripLength = THREE.MathUtils.clamp(options.glaze_drip_length ?? 1, 0.5, 5.0);
    const glazeSeed = options.glaze_seed ?? 1;
    const random = this.createRandomGenerator(glazeSeed);
    const material = this.createGlazeMaterial(options.glaze_color ?? '#ffffff');
    const hasWafer = Boolean(options.wafer_texture_url);

    const group = new THREE.Group();
    group.name = 'CakeGlaze';
    group.userData['glazeMaterial'] = material;
    group.userData['isCakeGlaze'] = true;

    if (metadata.shape === 'cuboid') {
      const cuboidGlaze = this.buildCuboidGlaze(
        topLayer,
        metadata,
        thickness,
        dripLength,
        material,
        random,
        hasWafer,
      );
      if (!cuboidGlaze) return null;

      group.add(cuboidGlaze);
      return group;
    }

    const cakeRadius = topLayer.radius ?? metadata.radius ?? 2;

    // 1. GÓRNA TAFLA (Czapa)
    // Musi wystawać poza tort (overhang), żeby sople spadały z "półki"
    const overhang = thickness * 0.1;
    const poolRadius = cakeRadius + overhang;
    const glazeVerticalOffset = hasWafer ? thickness * 0.2 : thickness * 0.35;

    if (!hasWafer) {
      const topGeo = new THREE.CylinderGeometry(poolRadius, poolRadius, thickness * 0.7, 64);
      const topMesh = new THREE.Mesh(topGeo, material);
      topMesh.userData['isCakeGlaze'] = true;
      topMesh.userData['isGlazeTop'] = true;
      topMesh.position.y = topLayer.topY + glazeVerticalOffset;
      group.add(topMesh);
    }

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
    rimMesh.position.y = topLayer.topY + glazeVerticalOffset;
    group.add(rimMesh);

    // 3. SOPLE
    // Startujemy wysoko, prawie w połowie grubości rantu
    const startY = topLayer.topY + glazeVerticalOffset;

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

  private static buildDripMesh(
    material: THREE.Material,
    baseThickness: number,
    baseLength: number,
    random: () => number,
  ): { mesh: THREE.Mesh; length: number } {
    const isLong = random() > 0.4;

    // Długość: Long (0.6 - 1.0 bazy), Short (0.2 - 0.4 bazy) -> małe kropelki
    const length = isLong
      ? baseLength * (0.6 + random() * 0.4)
      : baseLength * (0.35 + random() * 0.5);

    // Cienka szyjka
    const neckThickness = baseThickness * 0.2;

    // Kształt kropli: Jeśli sopel długi, to duża kropla. Jeśli krótki, to mała.
    const bulbScale = isLong ? 1.1 : 1.2;
    const bulbSize = neckThickness * bulbScale;

    // Geometria
    const radialSegs = 32;
    const heightSegs = Math.floor(length * 50) + 10; // Duża gęstość dla gładkości

    // openEnded: false -> zamykamy denko, żeby kropla była pełna od dołu
    const geometry = new THREE.CylinderGeometry(
      neckThickness,
      neckThickness,
      length,
      radialSegs,
      heightSegs,
      false,
    );

    const posAttribute = geometry.attributes['position'];
    const vertexCount = posAttribute.count;

    const wobblePhase = random() * 10;

    for (let i = 0; i < vertexCount; i++) {
      let x = posAttribute.getX(i);
      let y = posAttribute.getY(i);
      let z = posAttribute.getZ(i);

      // T: 0 (Góra) -> 1 (Dół)
      const t = 1.0 - ((y + length / 2) / length);

      // Normalize radial position
      const len = Math.sqrt(x * x + z * z);
      const nx = len > 0 ? x / len : 0;
      const nz = len > 0 ? z / len : 0;

      let currentRadius = neckThickness;

      // --- PROFILOWANIE GRUBOŚCI ---

      // 1. GÓRA (LEJEK) - Szerokie łączenie z rantem
      if (t < 0.18) {
        const topT = (0.18 - t) / 0.18; // 1 na samej górze
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
          // Faza 2: Idealne, sferyczne zamknięcie
          // Przeskalowujemy T, żeby szło od 0 (najszerszy punkt) do 1 (czubek)
          const sphereT = (bulbT - 0.3) / 0.7;

          // Wzór koła: sqrt(1 - x^2)
          // Math.max(0, ...) zabezpiecza przed błędem przy samym końcu
          const circleShape = Math.sqrt(Math.max(0, 1 - sphereT * sphereT));

          // Mnożymy bulbSize przez kształt.
          // Na samym końcu (sphereT=1) shape=0, więc promień=0.
          // To eliminuje płaskie denko.
          currentRadius = bulbSize * circleShape;
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
        x *= 1.0 + hookStrength * 0.8; // Szerzej na boki
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
    return { mesh, length };
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

      const { mesh, length } = this.buildDripMesh(material, baseThickness, baseLength, random);

      // --- POZYCJONOWANIE NA ZEWNĄTRZ ---
      // FIX "Wchodzenia w tort":
      // Radius tortu + połowa grubości szyjki + mały margines bezpieczeństwa (0.02)
      const placementRadius = cakeRadius;

      const px = Math.cos(angle) * placementRadius;
      const pz = Math.sin(angle) * placementRadius;
      const py = startY - 0.02 - length / 2;

      mesh.position.set(px, py, pz);

      // Kierujemy Z w stronę środka tortu
      mesh.lookAt(0, py, 0);

      // Losowy obrót na boki
      mesh.rotateZ((random() - 0.5) * 0.02);

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

  private static createRandomGenerator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      // Linear congruential generator for deterministic randomness
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  // ========= CUBOID HELPERS =========

  private static buildCuboidGlaze(
    layer: LayerMetadata,
    metadata: CakeMetadata,
    thickness: number,
    dripLength: number,
    material: THREE.MeshStandardMaterial,
    random: () => number,
    hasWafer: boolean,
  ): THREE.Group | null {
    const width = layer.width ?? metadata.width;
    const depth = layer.depth ?? metadata.depth;
    if (!width || !depth) return null;

    const group = new THREE.Group();
    group.userData['glazeMaterial'] = material;
    group.userData['isCakeGlaze'] = true;

    // ZMIANA 1: Mniejszy promień rogu, żeby polewa bardziej przylegała do kwadratu
    const cornerRadius = 0.15;
    // ZMIANA 2: Większy nawis, żeby przykryć krawędź
    const overhang = thickness * 0.2;
    const glazeVerticalOffset = hasWafer ? thickness * 0.2 : thickness * 0.35;

    // === 1. GÓRA ===
    if (!hasWafer) {
      const shape = this.getRoundedRectShape(
        width + overhang * 2,
        depth + overhang * 2,
        cornerRadius
      );

      const topGeo = new THREE.ExtrudeGeometry(shape, {
        depth: thickness * 0.5,
        bevelEnabled: false,
        curveSegments: 6
      });

      topGeo.rotateX(Math.PI / 2);

      // Falowanie góry
      const pos = topGeo.attributes['position'];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        if (y > 0.01) {
          const wave = Math.sin(x * 1.5) * Math.cos(z * 1.5) * (thickness * 0.05);
          const noise = Math.sin(x * 5 + z * 5) * (thickness * 0.02);
          pos.setY(i, y + wave + noise);
        }
      }
      topGeo.computeVertexNormals();

      const topMesh = new THREE.Mesh(topGeo, material);
      topMesh.userData['isCakeGlaze'] = true;
      topMesh.userData['isGlazeTop'] = true;
      topMesh.position.y = layer.topY + glazeVerticalOffset;
      group.add(topMesh);
    }

    // === 2. RANT ===
    const rimMesh = this.buildCuboidRimMesh(width, depth, thickness, overhang, material, layer.topY, cornerRadius);
    if (rimMesh) {
      rimMesh.userData['isCakeGlaze'] = true;
      group.add(rimMesh);
    }

    // === 3. SOPLE ===
    const dripsGroup = this.createCuboidDrips(
      layer.topY + glazeVerticalOffset,
      width,
      depth,
      material,
      thickness,
      dripLength,
      random,
    );
    dripsGroup.traverse((child) => (child.userData['isCakeGlaze'] = true));
    group.add(dripsGroup);

    return group;
  }

  private static createCuboidDrips(
    startY: number,
    width: number,
    depth: number,
    material: THREE.Material,
    baseThickness: number,
    baseLength: number,
    random: () => number,
  ): THREE.Group {
    const group = new THREE.Group();

    const points = this.buildCuboidRingPoints(width, depth, 40);
    const perimeter = 2 * (width + depth);
    const segmentDistance = perimeter / points.length;

    // Zwiększamy margines bezpieczny od rogu, żeby sople nie wchodziły na kule
    const cornerSafeMargin = 0.3;

    let index = 0;
    while (index < points.length) {
      const point = points[index];

      const distToCornerX = width / 2 - Math.abs(point.x);
      const distToCornerZ = depth / 2 - Math.abs(point.z);

      if (distToCornerX < cornerSafeMargin && distToCornerZ < cornerSafeMargin) {
        index++;
        continue;
      }

      const { mesh, length } = this.buildDripMesh(material, baseThickness, baseLength, random);

      // FIX: Obniżamy start sopla głębiej (0.06), żeby jego góra schowała się pod wałkiem
      const py = startY - 0.08 - length / 2;

      const neckThickness = baseThickness * 0.2;

      // FIX: Zmniejszamy offset. Teraz sopel jest bliżej ściany (prawie dotyka).
      // Mniejszy offset = mniej wystawania.
      const wallOffset = neckThickness * 0.2;

      const px = point.x + point.normal.x * wallOffset;
      const pz = point.z + point.normal.y * wallOffset;

      mesh.position.set(px, py, pz);

      // Rotacja: Patrzymy w stronę wnętrza
      const lookTarget = new THREE.Vector3(
        point.x - point.normal.x,
        py,
        point.z - point.normal.y
      );
      mesh.lookAt(lookTarget);

      mesh.rotateZ((random() - 0.5) * 0.05);

      group.add(mesh);



      const gapNoise = random();
      const desiredGap = 0.05 + gapNoise * 0.1 + (gapNoise > 0.9 ? 0.1 : 0.0);
      const stepDistance = desiredGap * 2.5;
      const step = Math.max(1, Math.round(stepDistance / segmentDistance));
      index += step;
    }

    return group;
  }

  // Tworzy kształt 2D prostokąta z zaokrąglonymi rogami
  private static getRoundedRectShape(width: number, depth: number, radius: number): THREE.Shape {
    const shape = new THREE.Shape();
    const w = width / 2;
    const d = depth / 2;

    // Rysujemy prostokąt z łukami na rogach
    shape.moveTo(-w + radius, -d);
    shape.lineTo(w - radius, -d);
    shape.quadraticCurveTo(w, -d, w, -d + radius);
    shape.lineTo(w, d - radius);
    shape.quadraticCurveTo(w, d, w - radius, d);
    shape.lineTo(-w + radius, d);
    shape.quadraticCurveTo(-w, d, -w, d - radius);
    shape.lineTo(-w, -d + radius);
    shape.quadraticCurveTo(-w, -d, -w + radius, -d);

    return shape;
  }

  private static buildCuboidRimMesh(
    width: number,
    depth: number,
    thickness: number,
    overhang: number,
    material: THREE.Material,
    topY: number,
    cornerRadius: number
  ): THREE.Object3D | null {

    const tubeRadius = thickness * 0.6;

    // Wymiary ścieżki
    const trackWidth = width + overhang * 2 - tubeRadius * 0.8;
    const trackDepth = depth + overhang * 2 - tubeRadius * 0.8;
    const straightLenX = trackWidth - 2 * cornerRadius;
    const straightLenZ = trackDepth - 2 * cornerRadius;

    if (straightLenX <= 0 || straightLenZ <= 0) return null;

    const group = new THREE.Group();
    // Ustawiamy grupę na 0,0,0, żeby transformacje wierzchołków działały w przestrzeni globalnej
    group.position.set(0, 0, 0);

    const rimY = topY + thickness * 0.005;

    // --- GEOMETRIE Z GĘSTĄ SIATKĄ (KLUCZ DO FALOWANIA) ---
    // Zmieniamy 4. parametr (heightSegments) z 1 na 32.
    // Dzięki temu rura składa się z wielu pierścieni i da się ją wyginać.
    const baseGeoH = new THREE.CylinderGeometry(tubeRadius, tubeRadius, straightLenX, 16, 32, true);
    const baseGeoV = new THREE.CylinderGeometry(tubeRadius, tubeRadius, straightLenZ, 16, 32, true);
    const baseGeoCorner = new THREE.TorusGeometry(cornerRadius, tubeRadius, 16, 32, Math.PI / 2);

    // --- FUNKCJA APLIKUJĄCA FALĘ ---
    const addWavyPart = (geometry: THREE.BufferGeometry, position: THREE.Vector3, rotation: THREE.Euler) => {
      const geo = geometry.clone();

      // 1. Ustawiamy klocek na właściwym miejscu
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion().setFromEuler(rotation);
      matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(matrix);

      // 2. MODYFIKUJEMY WIERZCHOŁKI (FALA)
      const pos = geo.attributes['position'];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        let y = pos.getY(i);
        const z = pos.getZ(i);

        // WZÓR NA FALĘ:
        // thickness * 0.15 -> Siła fali (zwiększona)
        // x * 1.2 + z * 1.2 -> Częstotliwość (gęstość) fal
        const waveBig = Math.sin(x * 1.2 + z * 1.2) * (thickness * 0.15);

        // Druga, mniejsza fala dla nieregularności
        const waveSmall = Math.cos(x * 3.0 - z * 3.0) * (thickness * 0.05);

        // Dodatkowy szum, żeby nie było zbyt idealnie
        const noise = Math.sin(x * 8) * 0.01;

        pos.setY(i, y + waveBig + waveSmall + noise);
      }

      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material);
      group.add(mesh);
    };

    // --- DEFINICJE ROTACJI ---
    const rotH = new THREE.Euler(0, 0, Math.PI / 2);      // Leży wzdłuż X
    const rotV = new THREE.Euler(Math.PI / 2, 0, 0);      // Leży wzdłuż Z

    // --- BUDOWANIE RANTU ---

    // 1. PROSTE ODCINKI
    addWavyPart(baseGeoH, new THREE.Vector3(0, rimY, -trackDepth / 2), rotH); // Tył
    addWavyPart(baseGeoH, new THREE.Vector3(0, rimY, trackDepth / 2), rotH);  // Przód
    addWavyPart(baseGeoV, new THREE.Vector3(-trackWidth / 2, rimY, 0), rotV); // Lewo
    addWavyPart(baseGeoV, new THREE.Vector3(trackWidth / 2, rimY, 0), rotV);  // Prawo

    // 2. NAROŻNIKI
    const cornerX = trackWidth / 2 - cornerRadius;
    const cornerZ = trackDepth / 2 - cornerRadius;

    // Prawy-Tył
    addWavyPart(baseGeoCorner, new THREE.Vector3(cornerX, rimY, -cornerZ), new THREE.Euler(Math.PI/2, 0, -Math.PI/2));
    // Prawy-Przód
    addWavyPart(baseGeoCorner, new THREE.Vector3(cornerX, rimY, cornerZ), new THREE.Euler(Math.PI/2,  0, 0));
    // Lewy-Przód
    addWavyPart(baseGeoCorner, new THREE.Vector3(-cornerX, rimY, cornerZ), new THREE.Euler(Math.PI/2, -Math.PI, 0));
    // Lewy-Tył
    addWavyPart(baseGeoCorner, new THREE.Vector3(-cornerX, rimY, -cornerZ), new THREE.Euler(Math.PI/2, -Math.PI, -Math.PI/2));


    return group;
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
