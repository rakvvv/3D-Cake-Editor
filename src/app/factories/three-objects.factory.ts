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
      const cuboidGlaze = this.buildCuboidGlaze(
        topLayer,
        metadata,
        thickness,
        dripLength,
        material,
        random,
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
      : baseLength * (0.2 + random() * 0.2);

    // Cienka szyjka
    const neckThickness = baseThickness * 0.2;

    // Kształt kropli: Jeśli sopel długi, to duża kropla. Jeśli krótki, to mała.
    const bulbScale = isLong ? 1.1 : 1.2;
    const bulbSize = neckThickness * bulbScale;

    // Geometria
    const radialSegs = 16;
    const heightSegs = Math.floor(length * 30) + 10; // Duża gęstość dla gładkości

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

          // Wzór na koło: sqrt(1 - x^2)
          // To sprawia, że ścianki schodzą się idealnie kuliście
          const shape = Math.sqrt(Math.max(0, 1 - bulbT * bulbT));

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

  // ========= CUBOID HELPERS =========

  private static buildCuboidGlaze(
    layer: LayerMetadata,
    metadata: CakeMetadata,
    thickness: number,
    dripLength: number,
    material: THREE.MeshStandardMaterial,
    random: () => number,
  ): THREE.Group | null {
    const width = layer.width ?? metadata.width;
    const depth = layer.depth ?? metadata.depth;
    if (!width || !depth) {
      return null;
    }

    const group = new THREE.Group();
    group.userData['glazeMaterial'] = material;
    group.userData['isCakeGlaze'] = true;

    const overhang = thickness * 0.1;
    const topMesh = new THREE.Mesh(
      new THREE.BoxGeometry(width + overhang * 2, thickness * 0.7, depth + overhang * 2),
      material,
    );
    topMesh.userData['isCakeGlaze'] = true;
    topMesh.position.y = layer.topY + thickness * 0.35;
    group.add(topMesh);

    const rimMesh = this.buildCuboidRimMesh(width, depth, thickness, overhang, material, layer.topY);
    if (rimMesh) {
      rimMesh.userData['isCakeGlaze'] = true;
      group.add(rimMesh);
    }

    const dripsGroup = this.createCuboidDrips(
      layer.topY + thickness * 0.35,
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
    const points = this.buildCuboidRingPoints(width, depth, 28);
    const perimeter = 2 * (width + depth);
    const segmentDistance = perimeter / points.length;

    let index = 0;
    while (index < points.length) {
      const point = points[index];
      const { mesh, length } = this.buildDripMesh(material, baseThickness, baseLength, random);
      const py = startY - 0.02 - length / 2;

      mesh.position.set(point.x, py, point.z);

      const lookAtTarget = new THREE.Vector3(point.x, py, point.z).add(
        new THREE.Vector3(point.normal.x, 0, point.normal.y),
      );
      mesh.lookAt(lookAtTarget);
      mesh.rotateZ((random() - 0.5) * 0.2);
      group.add(mesh);

      const gapNoise = random();
      const desiredGap = 0.05 + gapNoise * 0.1 + (gapNoise > 0.9 ? 0.1 : 0.0);
      const stepDistance = desiredGap * 2.5;
      const step = Math.max(1, Math.round(stepDistance / segmentDistance));
      index += step;
    }

    return group;
  }

  private static buildCuboidRimMesh(
    width: number,
    depth: number,
    thickness: number,
    overhang: number,
    material: THREE.Material,
    topY: number,
  ): THREE.Mesh | null {
    const outerHalfWidth = width / 2 + overhang;
    const outerHalfDepth = depth / 2 + overhang;
    const inset = Math.max(thickness * 0.35, 0.05);
    const innerHalfWidth = width / 2 - inset;
    const innerHalfDepth = depth / 2 - inset;
    if (innerHalfWidth <= 0 || innerHalfDepth <= 0) {
      return null;
    }

    const shape = new THREE.Shape();
    shape.moveTo(-outerHalfWidth, -outerHalfDepth);
    shape.lineTo(outerHalfWidth, -outerHalfDepth);
    shape.lineTo(outerHalfWidth, outerHalfDepth);
    shape.lineTo(-outerHalfWidth, outerHalfDepth);
    shape.lineTo(-outerHalfWidth, -outerHalfDepth);

    const hole = new THREE.Path();
    hole.moveTo(-innerHalfWidth, -innerHalfDepth);
    hole.lineTo(innerHalfWidth, -innerHalfDepth);
    hole.lineTo(innerHalfWidth, innerHalfDepth);
    hole.lineTo(-innerHalfWidth, innerHalfDepth);
    hole.lineTo(-innerHalfWidth, -innerHalfDepth);
    shape.holes.push(hole);

    const extrude = new THREE.ExtrudeGeometry(shape, {
      depth: thickness * 0.6,
      bevelEnabled: true,
      bevelThickness: thickness * 0.25,
      bevelSize: thickness * 0.18,
      bevelSegments: 2,
    });
    extrude.rotateX(-Math.PI / 2);
    extrude.translate(0, topY + thickness * 0.05, 0);

    return new THREE.Mesh(extrude, material);
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
