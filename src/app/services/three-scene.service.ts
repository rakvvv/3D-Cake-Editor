import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, lastValueFrom } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { FontLoader, Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TransformControlsService } from './transform-controls-service';
import { CakeOptions } from '../models/cake.options';
import { SceneInitService } from './scene-init.service';
import { DecorationsService } from './decorations.service';
import { PaintService } from './paint.service';
import { SurfacePaintingService } from './surface-painting.service';
import { ExportService } from './export.service';
import { ThreeObjectsFactory, CakeMetadata } from '../factories/three-objects.factory';
import { TextFactory } from '../factories/text.factory';
import { SnapService, SnappedDecorationState, SnapInfoSnapshot } from './snap.service';
import { DecorationValidationIssue } from '../models/decoration-validation';
import { DecorationInfo, DecorationPlacementType } from '../models/decorationInfo';
import { environment } from '../../environments/environment';
import { SceneOutlineNode } from '../models/scene-outline';
import { DecorationFactory } from '../factories/decoration.factory';
import { AnchorPresetsService } from './anchor-presets.service';
import { AnchorPoint, AnchorPreset } from '../models/anchors';
import { DecoratedCakePreset, DecorationPresetEntry } from '../models/cake-preset';

interface DecorationClipboardEntry {
  template: THREE.Object3D;
  worldPosition: THREE.Vector3;
  worldQuaternion: THREE.Quaternion;
  localScale: THREE.Vector3;
  snapInfo: SnapInfoSnapshot | null;
  pasteCount: number;
}

@Injectable({
  providedIn: 'root' // singleton (serwis dostępny przez całą aplikacje)
})
export class ThreeSceneService {
  public objects: THREE.Object3D[] = [];
  public cakeBase: THREE.Group | null = null;
  private cakeLayers: THREE.Mesh[] = [];
  private cakeMetadata: CakeMetadata | null = null;
  private textMesh: THREE.Object3D | null = null;
  private readonly fontCache = new Map<string, Font>();
  private readonly fontLoader = new FontLoader();
  private readonly fontUrls: Record<string, string> = {
    helvetiker: '/fonts/helvetiker_regular.typeface.json',
    optimer: '/fonts/optimer_regular.typeface.json',
    frosting: '/fonts/frosting_font.typeface.json',
  };
  private readonly candyPalette = [
    0xffa6d6,
    0xffd3a3,
    0x9ee7ff,
    0xc0ffc7,
  ];
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly endpoints = environment.endpoints;
  private options!: CakeOptions;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private boxHelper: THREE.BoxHelper | null = null;
  private boxHelperTarget: THREE.Object3D | null = null;
  private clipboard: DecorationClipboardEntry | null = null;
  private gridHelper: THREE.GridHelper | null = null;
  private axesHelper: THREE.AxesHelper | null = null;
  private cakeOutlineHelper: THREE.BoxHelper | null = null;
  private boundingBoxesEnabled = false;
  private highQualityMode = true;
  private readonly anchorOccupants = new Map<string, THREE.Object3D>();
  private readonly outlineChanged = new Subject<void>();
  public readonly outlineChanges$ = this.outlineChanged.asObservable();

  // Prevent multiple undo/redo executions from a single physical keydown.
  private lastUndoEventStamp: number | null = null;
  private lastRedoEventStamp: number | null = null;



  constructor(
    private http: HttpClient,
    private transformControlsService: TransformControlsService,
    private sceneInitService: SceneInitService,
    private decorationsService: DecorationsService,
    private paintService: PaintService,
    private surfacePainting: SurfacePaintingService,
    private exportService: ExportService,
    private snapService: SnapService,
    private anchorPresetsService: AnchorPresetsService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.paintService.sceneChanged$.subscribe(() => this.emitOutlineChanged());
  }

  public get scene(): THREE.Scene {
    return this.sceneInitService.scene;
  }

  private emitOutlineChanged(): void {
    this.outlineChanged.next();
    this.sceneInitService.requestRender();
  }

  public get camera(): THREE.Camera {
    return this.sceneInitService.camera;
  }

  public get renderer(): THREE.WebGLRenderer {
    return this.sceneInitService.renderer;
  }

  public requestRender(): void {
    this.sceneInitService.requestRender();
  }

  public getBackgroundMode(): 'light' | 'dark' {
    return this.sceneInitService.getBackgroundMode();
  }

  public toggleBackgroundMode(): 'light' | 'dark' {
    return this.sceneInitService.toggleBackgroundMode();
  }

  public isOrbitBusy(): boolean {
    return this.sceneInitService.isOrbitBusy();
  }

  public init(container: HTMLElement, options: CakeOptions): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.options = options;
    this.sceneInitService.init(container);
    DecorationFactory.initialize(this.renderer);
    this.paintService.registerScene(this.scene);
    this.transformControlsService.init(
      this.scene,
      this.camera,
      this.renderer,
      this.sceneInitService.orbit,
      () => this.updateBoxHelper(),
      (object) => this.removeDecoration(object),
      () => this.copySelectedDecoration(),
      () => this.pasteDecoration(),
    );

    this.gridHelper = new THREE.GridHelper(50, 50);
    this.scene.add(this.gridHelper);

    this.rebuildCake();

    if (this.options.cake_text) {
      const textSize = this.getCakeHorizontalSize() * 0.2;
      const textDepth = this.getTextDepth();
      const textHeight = this.getCakeTopHeight();
      const textConfig = this.resolveTextConfig(this.options);
      void this.loadAndAddText(this.options.cake_text_value, textSize, textHeight, textDepth, textConfig);
    }

    container.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }

      if (this.surfacePainting.enabled && this.cakeBase) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersectsCake = this.raycaster.intersectObject(this.cakeBase, true);
        const paintHit = this.pickPaintableHit(intersectsCake);
        if (!paintHit || this.transformControlsService.isDragging()) {
          this.onClickDown(event);
          return;
        }

        if (!this.isPaintable(paintHit.object)) {
          this.onClickDown(event);
          return;
        }

        this.surfacePainting.startStroke();
        this.sceneInitService.setOrbitEnabled(false);
        void this.surfacePainting.handlePointer(paintHit, this.scene);
        this.requestRender();
        return;
      }

      if (this.paintService.paintMode && this.cakeBase) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersectsCake = this.raycaster.intersectObject(this.cakeBase, true);
        if (!intersectsCake.length || this.transformControlsService.isDragging()) {
          this.onClickDown(event);
          return;
        }

        this.paintService.beginStroke(rect);
        this.sceneInitService.setOrbitEnabled(false);
        void this.paintService.handlePaint(
          event,
          this.renderer,
          this.camera,
          this.scene,
          this.cakeBase,
          this.mouse,
          this.raycaster,
        );
        this.requestRender();
      } else {
        this.onClickDown(event);
      }
    });

    container.addEventListener('mousemove', (event) => {
      if (this.surfacePainting.enabled && this.surfacePainting.isPainting() && this.cakeBase) {
        if (event.buttons !== undefined && (event.buttons & 1) === 0) {
          this.stopPaintingStroke();
          return;
        }

        if (this.transformControlsService.isDragging()) {
          this.stopPaintingStroke();
          return;
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersectsCake = this.raycaster.intersectObject(this.cakeBase, true);
        const paintHit = this.pickPaintableHit(intersectsCake);
        if (!paintHit) {
          return;
        }
        if (!this.isPaintable(paintHit.object)) {
          // Opcja A: Przerywamy ten konkretny "krok" malowania (pędzel nie stawia kropki, ale jak zjedziesz z polewy to maluje dalej)
          return;
        }
        void this.surfacePainting.handlePointer(paintHit, this.scene);
        this.requestRender();
        return;
      }

      if (!this.paintService.paintMode || !this.paintService.isPainting || !this.cakeBase) {
        return;
      }

      if (event.buttons !== undefined && (event.buttons & 1) === 0) {
        this.stopPaintingStroke();
        return;
      }

      if (this.transformControlsService.isDragging()) {
        this.stopPaintingStroke();
        return;
      }

      void this.paintService.handlePaint(
        event,
        this.renderer,
        this.camera,
        this.scene,
        this.cakeBase,
        this.mouse,
        this.raycaster,
      );
      this.requestRender();
    });

    const stopPainting = () => this.stopPaintingStroke();
    container.addEventListener('mouseup', stopPainting);
    container.addEventListener('mouseleave', stopPainting);
    container.addEventListener('contextmenu', (event) => {
      const painting =
        (this.paintService.paintMode && this.paintService.isPainting) ||
        (this.surfacePainting.enabled && this.surfacePainting.isPainting());
      const orbitActive = this.sceneInitService.isOrbitBusy(200);
      if (painting || orbitActive) {
        event.preventDefault();
      }
    });

    const ownerDocument = container.ownerDocument ?? document;
    ownerDocument.addEventListener('keydown', (event) => {
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      if (!ctrlOrMeta) {
        return;
      }

      if (event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();
      const wantsUndo = key === 'z' && !event.shiftKey;
      const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);

      if (wantsUndo) {
        if (this.paintService.canUndo()) {
          if (this.lastUndoEventStamp === event.timeStamp) {
            return;
          }
          this.lastUndoEventStamp = event.timeStamp;
          this.paintService.undo();
          event.preventDefault();
        }
      } else if (wantsRedo) {
        if (this.paintService.canRedo()) {
          if (this.lastRedoEventStamp === event.timeStamp) {
            return;
          }
          this.lastRedoEventStamp = event.timeStamp;
          this.paintService.redo();
          event.preventDefault();
        }
      }
    });
  }

  public reattachRenderer(container: HTMLElement): void {
    this.sceneInitService.reattachRenderer(container);
    this.requestRender();
  }

  private stopPaintingStroke(): void {
    this.surfacePainting.endStroke();
    this.paintService.endStroke();
    this.sceneInitService.setOrbitEnabled(true);
    this.requestRender();
  }

  public updateCakeOptions(options: CakeOptions): void {
    this.options = options;
    this.rebuildCake();

    if (options.cake_text) {
      const textSize = this.getCakeHorizontalSize() * 0.2;
      const textDepth = this.getTextDepth(options);
      const textHeight = this.getCakeTopHeight();
      const textConfig = this.resolveTextConfig(options);
      void this.loadAndAddText(options.cake_text_value, textSize, textHeight, textDepth, textConfig);
    } else {
      this.removeCakeText();
    }

    const effectiveSize = this.cakeMetadata ? this.cakeMetadata.totalHeight * options.cake_size : options.cake_size;
    this.transformControlsService.updateCakeSize(effectiveSize);
    this.sceneInitService.updateOrbitForCake(effectiveSize);
    this.updateCakeOutlineHelper();
    this.requestRender();
  }

  public setGridVisible(visible: boolean): void {
    if (!this.gridHelper) {
      this.gridHelper = new THREE.GridHelper(50, 50);
      this.scene.add(this.gridHelper);
    }
    this.gridHelper.visible = visible;
    this.requestRender();
  }

  public setAxesVisible(visible: boolean): void {
    if (!this.axesHelper) {
      this.axesHelper = new THREE.AxesHelper(6);
      this.axesHelper.position.setY(0.01);
      this.scene.add(this.axesHelper);
    }
    this.axesHelper.visible = visible;
    this.requestRender();
  }

  public setCakeOutlineVisible(visible: boolean): void {
    if (!visible) {
      this.disposeCakeOutline();
      return;
    }

    if (!this.cakeBase) {
      return;
    }

    if (!this.cakeOutlineHelper) {
      this.cakeOutlineHelper = new THREE.BoxHelper(this.cakeBase, 0x3b82f6);
      this.scene.add(this.cakeOutlineHelper);
    }

    this.cakeOutlineHelper.visible = true;
    this.cakeOutlineHelper.update();
    this.requestRender();
  }

  public setBoundingBoxesVisible(visible: boolean): void {
    this.boundingBoxesEnabled = visible;
    if (!visible) {
      this.hideBoxHelper();
    } else {
      const selected = this.transformControlsService.getSelectedObject();
      const fallback = selected ?? this.cakeBase ?? null;
      if (fallback) {
        this.showBoxHelperFor(fallback);
      }
    }
    this.requestRender();
  }

  public setAnchorMarkersVisible(visible: boolean): void {
    this.anchorPresetsService.setMarkersVisible(visible);
    this.requestRender();
  }

  public areAnchorMarkersVisible(): boolean {
    return this.anchorPresetsService.areMarkersVisible();
  }

  public setHighQualityMode(enabled: boolean): void {
    this.highQualityMode = enabled;
    this.sceneInitService.renderer.shadowMap.enabled = enabled;
    this.scene.traverse((child) => {
      if ((child as THREE.Light).isLight) {
        const light = child as THREE.Light;
        if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight || light instanceof THREE.PointLight) {
          light.castShadow = enabled;
        } else {
          light.castShadow = false;
        }
      }
    });
    this.requestRender();
  }

  public isHighQualityMode(): boolean {
    return this.highQualityMode;
  }

  public setCameraMode(mode: 'perspective' | 'orthographic'): void {
    this.sceneInitService.setCameraMode(mode);
  }

  public setCameraPreset(preset: 'default' | 'isometric' | 'top' | 'front' | 'right'): void {
    this.sceneInitService.setCameraPreset(preset);
  }

  public setHorizontalOrbitLock(enabled: boolean): void {
    this.sceneInitService.setHorizontalOrbitLock(enabled);
  }

  public resetOrbitPivot(): void {
    if (this.cakeMetadata) {
      this.sceneInitService.resetOrbitPivot();
    }
  }

  public hasDecorationsOrPaint(): boolean {
    return this.collectDecorationRoots().length > 0;
  }

  private rebuildCake(): void {
    if (!this.scene) {
      return;
    }

    const snappedState: SnappedDecorationState[] = this.snapService.captureSnappedDecorations(
      this.collectDecorationRoots(),
    );

    this.removeCakeText();
    this.disposeCake();

    const { cake, layers, metadata } = ThreeObjectsFactory.createCake(this.options);
    this.cakeBase = cake;
    this.cakeLayers = layers;
    this.cakeMetadata = metadata;

    this.surfacePainting.attachCake(cake);

    this.applyCakeTransforms();

    this.scene.add(cake);
    this.objects.push(cake);
    this.snapService.setCakeBase(cake);
    this.anchorPresetsService.setContext(this.scene, this.cakeBase, this.cakeMetadata);
    const effectiveSize = this.cakeMetadata ? this.cakeMetadata.totalHeight * this.options.cake_size : this.options.cake_size;
    this.transformControlsService.updateCakeSize(effectiveSize);
    this.sceneInitService.updateOrbitForCake(effectiveSize);
    this.updateCakeOutlineHelper();

    if (snappedState.length) {
      this.snapService.restoreSnappedDecorations(snappedState);
      this.transformControlsService.syncLockedSelectionSnapshot();
      this.updateBoxHelper();
    }

    this.emitOutlineChanged();
    this.requestRender();
  }

  private disposeCake(): void {
    if (!this.cakeBase) {
      return;
    }

    const waferObjects = this.cakeBase.children.filter((child) => child.userData['isCakeWafer']);

    const children = [...this.cakeBase.children];
    children.forEach((child) => {
      if (child.userData['isCakeLayer'] || child.userData['isCakeGlaze'] || child.userData['isCakeWafer']) {
        return;
      }

      this.scene.attach(child);
      child.userData['isSnapped'] = false;
    });

    this.scene.remove(this.cakeBase);
    this.objects = this.objects.filter((obj) => obj !== this.cakeBase);

    this.cakeLayers.forEach((layer) => {
      layer.geometry.dispose();
    });

    const material = this.cakeBase.userData['material'] as THREE.Material | undefined;
    if (material) {
      material.dispose();
    }

    const glazeObject = this.cakeBase.userData['glaze'] as THREE.Object3D | null;
    if (glazeObject) {
      this.scene.remove(glazeObject);
      this.disposeGlazeObject(glazeObject);
    }

    waferObjects.forEach((wafer) => this.disposeWaferObject(wafer));

    this.disposeCakeOutline();
    this.cakeBase = null;
    this.cakeLayers = [];
    this.cakeMetadata = null;
    this.anchorPresetsService.setContext(this.scene, null, null);
    this.snapService.setCakeBase(null);
  }

  private updateCakeOutlineHelper(): void {
    if (!this.cakeOutlineHelper || !this.cakeBase) {
      return;
    }

    this.cakeOutlineHelper.update();
  }

  private disposeCakeOutline(): void {
    if (!this.cakeOutlineHelper) {
      return;
    }

    this.scene.remove(this.cakeOutlineHelper);
    this.cakeOutlineHelper.geometry.dispose();
    (this.cakeOutlineHelper.material as THREE.Material).dispose();
    this.cakeOutlineHelper = null;
  }

  private disposeGlazeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) {
        return;
      }

      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose());
      } else {
        material?.dispose();
      }
    });
  }

  private disposeWaferObject(object: THREE.Object3D): void {
    const mesh = object as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) {
      return;
    }

    mesh.traverse((child) => {
      const typedChild = child as THREE.Mesh;
      if (!(typedChild as { isMesh?: boolean }).isMesh) {
        return;
      }

      typedChild.geometry?.dispose();
      const material = typedChild.material;
      if (Array.isArray(material)) {
        material.forEach((mat) => this.disposeWaferMaterial(mat));
      } else {
        this.disposeWaferMaterial(material);
      }
    });

    const detailTexture = mesh.userData['waferDetailTexture'] as THREE.Texture | undefined;
    detailTexture?.dispose();
  }

  private disposeWaferMaterial(material: THREE.Material | null | undefined): void {
    if (!material) {
      return;
    }

    const typed = material as THREE.MeshStandardMaterial;
    typed.map?.dispose();
    typed.alphaMap?.dispose();
    typed.roughnessMap?.dispose();
    typed.bumpMap?.dispose();
    material.dispose();
  }

  private applyCakeTransforms(): void {
    if (!this.cakeBase || !this.cakeMetadata) {
      return;
    }

    const scale = this.options.cake_size;
    this.cakeBase.scale.set(scale, scale, scale);
    const totalHeight = this.cakeMetadata.totalHeight * scale;
    this.cakeBase.position.set(0, totalHeight / 2, 0);

    const material = this.cakeBase.userData['material'] as THREE.MeshStandardMaterial | undefined;
    if (material) {
      material.color.set(this.options.cake_color);
      const textures = [material.map, material.bumpMap, material.roughnessMap];
      textures.forEach((texture) => {
        if (texture) {
          texture.repeat.set(2 * scale, 2 * scale);
        }
      });
    }
  }

  private getCakeTopHeight(): number {
    if (!this.cakeMetadata) {
      return this.options.cake_size * 2;
    }

    return this.cakeMetadata.totalHeight * this.options.cake_size;
  }

  private removeCakeText(): void {
    if (!this.textMesh) {
      return;
    }

    this.scene.remove(this.textMesh);
    this.disposeTextObject(this.textMesh);
    this.textMesh = null;
  }

  private getCakeHorizontalSize(): number {
    if (!this.cakeMetadata) {
      return this.options.cake_size;
    }

    const scale = this.options.cake_size;
    const topLayer = this.cakeMetadata.layerDimensions[this.cakeMetadata.layerDimensions.length - 1];

    if (this.cakeMetadata.shape === 'cylinder') {
      const radius = topLayer?.radius ?? this.cakeMetadata.radius ?? 1;
      return radius * scale;
    }

    const width = topLayer?.width ?? this.cakeMetadata.width ?? 1;
    const depth = topLayer?.depth ?? this.cakeMetadata.depth ?? 1;
    return (Math.min(width, depth) / 2) * scale;
  }

  private getTextDepth(options?: CakeOptions): number {
    const source = options ?? this.options;
    const requested = source.cake_text_depth ?? 0.1;
    return THREE.MathUtils.clamp(requested, 0.01, 0.35);
  }

  private resolveTextConfig(options: CakeOptions): {
    position: 'top' | 'side';
    offset: number;
    font: string;
  } {
    return {
      position: options.cake_text_position ?? 'top',
      offset: options.cake_text_offset ?? 0,
      font: options.cake_text_font ?? 'helvetiker',
    };
  }

  private async loadFont(fontKey: string): Promise<Font> {
    const cached = this.fontCache.get(fontKey);
    if (cached) {
      return cached;
    }

    const url = this.fontUrls[fontKey];
    if (!url) {
      throw new Error(`Font mapping for "${fontKey}" not found.`);
    }

    return await new Promise<Font>((resolve, reject) => {
      this.fontLoader.load(
        url,
        (font) => {
          this.fontCache.set(fontKey, font);
          resolve(font);
        },
        undefined,
        (err) => {
          console.error(`Błąd ładowania czcionki ${fontKey}:`, err);
          reject(err);
        }
      );
    });
  }

  private async loadAndAddText(
    text: string,
    size: number,
    height: number,
    depth: number,
    config: { position: 'top' | 'side'; offset: number; font: string },
  ): Promise<void> {
    const normalizedText = text ?? '';
    const lines = this.extractTextLines(normalizedText);
    const hasVisibleCharacters = lines.some((line) => line.trim().length > 0);
    if (!hasVisibleCharacters) {
      this.removeCakeText();
      return;
    }

    let font: Font;
    try {
      font = await this.loadFont(config.font);
    } catch (error) {
      console.error('Nie udało się załadować czcionki dla napisu.', error);
      return;
    }

    this.removeCakeText();

    const baseRadius = Math.max(this.getCakeHorizontalSize(), 0.3);
    const normalizedOffset = THREE.MathUtils.clamp(config.offset, -0.5, 0.5);
    const radiusMultiplier = config.position === 'top'
      ? THREE.MathUtils.clamp(1 + normalizedOffset, 0.5, 1.5)
      : 1;
    const clearance = 0.01;
    const sideRadius = Math.max(baseRadius + depth / 2 - clearance, 0.2);
    const radius = config.position === 'top'
      ? Math.max(baseRadius * radiusMultiplier, 0.2)
      : sideRadius;

    const candyMaterial = this.createCandyMaterial(normalizedText);
    const textObject = config.position === 'top'
      ? this.createFlatTextGroup(font, normalizedText, size, depth, candyMaterial)
      : this.createCurvedTextGroup(font, normalizedText, size, depth, radius, candyMaterial);
    textObject.userData['isCakeText'] = true;

    if (config.position === 'top') {
      const lift = depth / 2 + 0.001;
      textObject.position.set(0, height + lift, 0);
      textObject.rotation.x = -Math.PI / 2;
    } else {
      const totalHeight = this.getCakeTopHeight();
      const halfHeight = totalHeight / 2;
      textObject.position.set(0, halfHeight + normalizedOffset * halfHeight, 0);
    }

    this.scene.add(textObject);
    this.textMesh = textObject;
  }

  private createFlatTextGroup(
    font: Font,
    text: string,
    size: number,
    depth: number,
    material: THREE.Material,
  ): THREE.Group {
    const group = new THREE.Group();
    if (!text) {
      return group;
    }

    const mesh = TextFactory.createTextMesh(font, text, {
      size,
      depth,
      curveSegments: 16,
      center: true,
      material,
      bevelEnabled: true,
      bevelThickness: Math.max(depth * 0.6, 0.015),
      bevelSize: Math.max(size * 0.04, 0.01),
      bevelSegments: 5,
    });
    group.add(mesh);
    return group;
  }

  private createCurvedTextGroup(
    font: Font,
    text: string,
    size: number,
    depth: number,
    radius: number,
    material: THREE.Material,
  ): THREE.Group {
    const group = new THREE.Group();
    if (!text) {
      return group;
    }

    const characters = Array.from(text);
    const advances = characters.map((character) => this.computeGlyphAdvance(font, character, size));
    const averageAdvance = advances.length
      ? advances.reduce((sum, advance) => sum + advance, 0) / advances.length
      : size * 0.5;
    const letterSpacing = Math.max(size * 0.08, averageAdvance * 0.18);
    const radiusSafe = Math.max(radius, 0.2);

    const letters = characters.map((character, index) => {
      const advance = advances[index];
      if (!character.trim().length) {
        return { mesh: null as THREE.Mesh | null, width: advance };
      }

      const mesh = TextFactory.createTextMesh(font, character, {
        size,
        depth,
        curveSegments: 12,
        center: false,
        align: 'left',
        verticalAlign: 'baseline',
        material,
        bevelEnabled: true,
        bevelSize: Math.max(size * 0.03, 0.008),
        bevelThickness: Math.max(depth * 0.4, 0.01),
        bevelSegments: 3,
      });
      const width = advance || this.measureTextWidth(mesh.geometry as THREE.BufferGeometry, size * 0.6);
      const normalizedWidth = Math.max(width, size * 0.2);
      const bufferGeometry = mesh.geometry as THREE.BufferGeometry;
      bufferGeometry.translate(-normalizedWidth / 2, 0, 0);
      return { mesh, width: normalizedWidth };
    });

    const totalArcLength = letters.reduce((length, letter, index) => {
      const spacing = index < letters.length - 1 ? letterSpacing : 0;
      return length + letter.width + spacing;
    }, 0);
    const startArc = -totalArcLength / 2;

    let cursor = startArc;
    letters.forEach((letter, index) => {
      const centerArc = cursor + letter.width / 2;
      const angle = radiusSafe > 0 ? centerArc / radiusSafe : 0;
      if (letter.mesh) {
        letter.mesh.position.set(
          Math.sin(angle) * radiusSafe,
          0,
          Math.cos(angle) * radiusSafe,
        );
        letter.mesh.rotation.y = angle;
        group.add(letter.mesh);
      }
      cursor += letter.width + (index < letters.length - 1 ? letterSpacing : 0);
    });

    return group;
  }

  private extractTextLines(value: string): string[] {
    const rawLines = value.split(/\r?\n/);
    if (!rawLines.length) {
      return [''];
    }
    let endIndex = rawLines.length - 1;
    while (endIndex > 0 && !rawLines[endIndex].trim().length) {
      endIndex--;
    }
    return rawLines.slice(0, endIndex + 1);
  }

  private getLineHeight(size: number): number {
    return size * 1.25;
  }

  private computeGlyphAdvance(font: Font, character: string, size: number): number {
    const glyphs = font?.data?.glyphs ?? {};
    const directGlyph = glyphs[character];
    const codeGlyph = glyphs[character.charCodeAt(0)];
    const fallbackGlyph = glyphs[' '] ?? glyphs[32];
    const glyph = directGlyph ?? codeGlyph ?? fallbackGlyph;
    const resolution = font?.data?.resolution ?? 1000;
    const baseAdvance = glyph?.ha ?? resolution * 0.5;
    const advance = (baseAdvance / resolution) * size;
    if (!isFinite(advance) || advance <= 0) {
      return size * (character.trim().length ? 0.5 : 0.4);
    }
    return advance;
  }

  private measureTextWidth(geometry: THREE.BufferGeometry, fallback: number): number {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) {
      return fallback;
    }
    return Math.max(box.max.x - box.min.x, fallback * 0.25);
  }


  private disposeTextObject(object: THREE.Object3D): void {
    const materials = new Set<THREE.Material>();
    object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
      geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((mat) => materials.add(mat));
      } else if (material) {
        materials.add(material);
      }
    });
    materials.forEach((material) => material.dispose());
  }

  private createCandyMaterial(seedText: string): THREE.MeshPhysicalMaterial {
    const paletteIndex = this.pickCandyPaletteIndex(seedText);
    const paletteColor = new THREE.Color(this.candyPalette[paletteIndex]);
    const cakeColor = new THREE.Color(this.options?.cake_color ?? '#ffffff');
    const baseColor = paletteColor.clone().lerp(cakeColor, 0.15);
    const faceColor = baseColor.clone().lerp(new THREE.Color('#ffffff'), 0.3);
    const material = new THREE.MeshPhysicalMaterial({
      color: faceColor,
      roughness: 0.35,
      metalness: 0.05,
      clearcoat: 0.2,
      clearcoatRoughness: 0.6,
    });
    material.emissive.copy(baseColor.clone().multiplyScalar(0.2));
    material.emissiveIntensity = 0.35;
    material.sheen = 0.5;
    material.sheenColor = faceColor.clone().lerp(new THREE.Color('#fff5fb'), 0.4);
    material.sheenRoughness = 0.25;
    return material;
  }

  private pickCandyPaletteIndex(seedText: string): number {
    if (!seedText.length) {
      return 0;
    }
    const seed = seedText.split('').reduce((acc, char, index) => acc + char.charCodeAt(0) * (index + 1), 0);
    return Math.abs(seed) % this.candyPalette.length;
  }
  // TODO zapisanie sceny lokalnie
  // public getSceneConfiguration(): any {
  //   return this.objects.map((obj, index) => ({
  //     id: index,
  //     position: obj.position.toArray()
  //   }));
  // }

  // TODO zrobic zapisywanie modelu
  public saveSceneConfiguration(data: any): Observable<any> {
    return this.http.post(`${this.apiBaseUrl}/${this.endpoints.saveScene}`, data);
  }

  public getSceneConfiguration(sceneId: string): Observable<any> {
    return this.http.get(`${this.apiBaseUrl}/${this.endpoints.scene}/${sceneId}`);
  }

  public async loadDecorationsData(): Promise<void> {
    try {
      const decorations = await lastValueFrom(
        this.http.get<DecorationInfo[]>(`${this.apiBaseUrl}/${this.endpoints.decorations}`)
      );
      this.decorationsService.setDecorations(decorations ?? []);
    } catch (error) {
      console.error('Błąd ładowania danych dekoracji z API:', error);
      this.decorationsService.setDecorations([]);
    }
  }

  public async addDecorationFromModel(
    identifier: string,
    preferredSurface?: 'TOP' | 'SIDE',
    targetLayerIndex?: number
  ): Promise<void> {
    if (!this.cakeBase) {
      return;
    }

    const decoration = await this.decorationsService.addDecorationFromModel(
      identifier,
      this.scene,
      this.cakeBase,
      this.objects,
      preferredSurface,
      targetLayerIndex
    );
    if (decoration) {
      this.paintService.registerDecorationAddition(decoration);
      this.emitOutlineChanged();
    }
  }

  public exportOBJ(): string {
    return this.exportService.exportOBJ(this.scene);
  }

  public exportSTL(): string {
    return this.exportService.exportSTL(this.scene);
  }

  public exportGLTF(callback: (gltf: object) => void): void {
    this.exportService.exportGLTF(this.scene, callback);
  }

  public async generateCakeThumbnailBlob(): Promise<Blob> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('Thumbnail generation is only available in the browser');
    }

    const targetSize = 512;
    const boundingBox = new THREE.Box3();

    if (this.cakeBase) {
      boundingBox.expandByObject(this.cakeBase);
    }

    this.collectDecorationRoots().forEach((object) => boundingBox.expandByObject(object));

    if (boundingBox.isEmpty()) {
      throw new Error('Scene is empty; nothing to capture');
    }

    const center = boundingBox.getCenter(new THREE.Vector3());
    const sphere = boundingBox.getBoundingSphere(new THREE.Sphere());
    const thumbnailCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    const viewDirection = new THREE.Vector3(1.2, 1, 1.4).normalize();
    const distance = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(thumbnailCamera.fov) / 2)) * 1.2;

    thumbnailCamera.position.copy(center.clone().add(viewDirection.multiplyScalar(distance)));
    thumbnailCamera.up.set(0, 1, 0);
    thumbnailCamera.lookAt(center);
    thumbnailCamera.updateProjectionMatrix();

    const renderTarget = new THREE.WebGLRenderTarget(targetSize, targetSize, {
      samples: this.renderer.capabilities.isWebGL2 ? 4 : 0,
    });

    const previousTarget = this.renderer.getRenderTarget();
    const previousSize = this.renderer.getSize(new THREE.Vector2());
    const previousPixelRatio = this.renderer.getPixelRatio();
    const previousClearColor = this.renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = this.renderer.getClearAlpha();
    const previousBackground = this.scene.background;
    const gridVisible = this.gridHelper?.visible ?? false;
    const axesVisible = this.axesHelper?.visible ?? false;
    const neutralBackground = new THREE.Color(0xf8f8f8);

    if (this.gridHelper) {
      this.gridHelper.visible = false;
    }

    if (this.axesHelper) {
      this.axesHelper.visible = false;
    }

    try {
      this.scene.background = neutralBackground;
      this.renderer.setPixelRatio(1);
      this.renderer.setRenderTarget(renderTarget);
      this.renderer.setSize(targetSize, targetSize, false);
      this.renderer.setClearColor(neutralBackground, 1);
      this.renderer.render(this.scene, thumbnailCamera);

      const buffer = new Uint8Array(targetSize * targetSize * 4);
      this.renderer.readRenderTargetPixels(renderTarget, 0, 0, targetSize, targetSize, buffer);

      const flipped = new Uint8ClampedArray(buffer.length);
      const stride = targetSize * 4;
      for (let y = 0; y < targetSize; y++) {
        const srcStart = (targetSize - 1 - y) * stride;
        const destStart = y * stride;
        flipped.set(buffer.subarray(srcStart, srcStart + stride), destStart);
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not create canvas context');
      }

      const imageData = new ImageData(flipped, targetSize, targetSize);
      ctx.putImageData(imageData, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Failed to generate thumbnail blob'));
          }
        }, 'image/png');
      });

      return blob;
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setPixelRatio(previousPixelRatio);
      this.renderer.setSize(previousSize.x, previousSize.y, false);
      this.renderer.setClearColor(previousClearColor, previousClearAlpha);
      this.scene.background = previousBackground;

      if (this.gridHelper) {
        this.gridHelper.visible = gridVisible;
      }

      if (this.axesHelper) {
        this.axesHelper.visible = axesVisible;
      }

      renderTarget.dispose();
    }
  }

  public takeScreenshot(): string {
    return this.exportService.screenshot(this.renderer);
  }
  private onClickDown(event: MouseEvent): void {
    this.handleInteraction(event.clientX, event.clientY, true);
  }

  // public attachSelectedToCake(): void {
  //   const selected = this.transformControlsService.getSelectedObject();
  //   console.log("Wywołano attachSelectedToCake. Zaznaczony obiekt:", selected);
  //   if (!selected) {
  //     console.warn('Brak zaznaczonego obiektu!');
  //     return;
  //   }
  //
  //   if (selected.parent === this.cakeBase) {
  //     console.log('Obiekt już jest przypięty do tortu.');
  //     return;
  //   }
  //
  //   this.cakeBase.attach(selected);
  // }

  private handleInteraction(clientX: number, clientY: number, attach = false): THREE.Object3D | null {
    if (this.transformControlsService.isDragging()) {
      return null;
    }

    if (attach) {
      this.hideBoxHelper();
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const canClickAnchors =
      this.anchorPresetsService.areMarkersVisible() &&
      (this.anchorPresetsService.getActionMode() === 'move' || !this.transformControlsService.getSelectedObject());

    if (canClickAnchors) {
      const anchorHit = this.anchorPresetsService.pickAnchor(this.raycaster);
      if (anchorHit) {
        this.anchorPresetsService.emitAnchorClick(anchorHit.id);
        return null;
      }
    }
    const intersects = this.raycaster.intersectObjects(
      this.objects.filter((obj) => obj !== this.cakeBase && !obj.userData['isPainted']),
      true,
    );

    if (intersects.length === 0) {
      if (attach) {
        this.transformControlsService.deselectObject();
        this.hideBoxHelper();
        this.anchorPresetsService.setHighlightedDecoration(null);
      }
      return null;
    }

    const candidate = this.findParentDecoration(intersects[0].object) ?? intersects[0].object;
    const selected = candidate === this.cakeBase ? null : candidate;

    if (!selected) {
      if (attach) {
        this.transformControlsService.deselectObject();
        this.hideBoxHelper();
      }
      return null;
    }

    if (!this.objects.includes(selected)) {
      if (selected.userData['isDecoration']) {
        this.objects.push(selected);
      } else {
        if (attach) {
          this.transformControlsService.deselectObject();
          this.hideBoxHelper();
        }
        return null;
      }
    }

    if (attach) {
      this.transformControlsService.attachObject(selected);
      const modelId = (selected.userData['modelFileName'] as string | undefined) ?? null;
      this.anchorPresetsService.setHighlightedDecoration(modelId);
      this.emitOutlineChanged();
    }

    return selected;
  }


  private onTouchStart(event: TouchEvent): void {
    if (event.touches.length > 0) {
      this.handleInteraction(event.touches[0].clientX, event.touches[0].clientY, true);
    }
  }

  // --- Funkcje pomocnicze dla BoxHelper ---
  private showBoxHelperFor(object: THREE.Object3D): void {
    if (!this.boundingBoxesEnabled) {
      return;
    }

    this.hideBoxHelper(); // Usuń stary
    this.boxHelper = new THREE.BoxHelper(object, 0xff0000); // Czerwony kolor
    this.boxHelperTarget = object;
    this.scene.add(this.boxHelper);
    // Aktualizuj BoxHelper, gdy obiekt się porusza (w TransformControlsService)
  }

  private hideBoxHelper(): void {
    if (this.boxHelper) {
      this.scene.remove(this.boxHelper);
      this.boxHelper.dispose(); // Zwolnij zasoby
      this.boxHelper = null;
      this.boxHelperTarget = null;
    }
  }

  public updateBoxHelper(): void {
    if (!this.boundingBoxesEnabled) {
      this.hideBoxHelper();
      return;
    }

    const selected = this.transformControlsService.getSelectedObject();
    const target = selected ?? this.cakeBase ?? null;

    if (!target) {
      this.hideBoxHelper();
      return;
    }

    if (!this.boxHelper || this.boxHelperTarget !== target) {
      this.showBoxHelperFor(target);
    }

    this.boxHelper?.update();
  }
  // --- Koniec funkcji BoxHelper ---

  private frameObject(object: THREE.Object3D): void {
    const boundingBox = new THREE.Box3().setFromObject(object);
    if (boundingBox.isEmpty()) {
      return;
    }

    const size = boundingBox.getSize(new THREE.Vector3());
    const center = boundingBox.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
    const padding = 1.6;

    const currentDirection = this.sceneInitService.camera.position
      .clone()
      .sub(this.sceneInitService.getOrbitTarget())
      .normalize();
    if (currentDirection.lengthSq() < 1e-4) {
      currentDirection.set(1, 1, 1).normalize();
    }

    if (this.sceneInitService.camera instanceof THREE.PerspectiveCamera) {
      const camera = this.sceneInitService.camera as THREE.PerspectiveCamera;
      const distance = (maxSize * padding) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      camera.position.copy(center.clone().add(currentDirection.multiplyScalar(distance + maxSize)));
      camera.lookAt(center);
    } else if (this.sceneInitService.camera instanceof THREE.OrthographicCamera) {
      const camera = this.sceneInitService.camera as THREE.OrthographicCamera;
      const viewWidth = camera.right - camera.left;
      const viewHeight = camera.top - camera.bottom;
      const requiredZoom = Math.min(viewWidth / (size.x * padding), viewHeight / (size.y * padding));
      camera.zoom = Math.max(0.3, Math.min(6, requiredZoom));
      camera.position.copy(center.clone().add(currentDirection.multiplyScalar(maxSize * padding * 2)));
      camera.lookAt(center);
      camera.updateProjectionMatrix();
    }

    this.sceneInitService.setOrbitTarget(center);
  }

  public removeDecoration(object: THREE.Object3D): void {
    if (!object) {
      return;
    }

    const parent = object.parent;
    if (parent) {
      parent.remove(object);
    } else {
      this.scene.remove(object);
    }
    this.objects = this.objects.filter((entry) => entry !== object);

    object.traverse((child) => {
      this.snapService.clearSnapInfo(child);
      this.disposeObjectResources(child);
    });

    const anchorId = object.userData['anchorId'] as string | undefined;
    if (anchorId) {
      this.clearAnchorOccupant(anchorId, object);
    }

    this.emitOutlineChanged();
  }

  public deleteSelectedDecoration(): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    this.transformControlsService.deselectObject();
    this.removeDecoration(selected);
    this.hideBoxHelper();

    return { success: true, message: 'Dekoracja została usunięta.' };
  }

  private clearAllDecorations(): void {
    const decorations = this.collectDecorationRoots();
    decorations.forEach((object) => this.removeDecoration(object));
    this.anchorOccupants.clear();
  }

  public copySelectedDecoration(): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    const template = this.duplicateDecoration(selected);
    const worldPosition = selected.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = selected.getWorldQuaternion(new THREE.Quaternion());
    const localScale = selected.scale.clone();

    const snappedStates = this.snapService.captureSnappedDecorations([selected]);
    const snapInfo = snappedStates.length > 0 ? this.cloneSnapInfo(snappedStates[0].info) : null;

    this.clipboard = {
      template,
      worldPosition,
      worldQuaternion,
      localScale,
      snapInfo,
      pasteCount: 0,
    };

    return {
      success: true,
      message: 'Dekoracja skopiowana. Użyj Wklej, aby utworzyć kopię.',
    };
  }

  public pasteDecoration(): { success: boolean; message: string } {
    if (!this.clipboard) {
      return { success: false, message: 'Najpierw skopiuj dekorację.' };
    }

    const { template, worldPosition, worldQuaternion, localScale, snapInfo, pasteCount } = this.clipboard;

    if (snapInfo && !this.cakeBase) {
      return {
        success: false,
        message: 'Brak tortu – nie można wkleić przyczepionej dekoracji.',
      };
    }

    const instance = this.duplicateDecoration(template);
    instance.scale.copy(localScale);

    this.scene.add(instance);
    this.objects.push(instance);

    if (snapInfo && this.cakeBase) {
      const adjustedInfo = this.cloneSnapInfo(snapInfo);
      adjustedInfo.offset = Math.max(0, adjustedInfo.offset + (pasteCount + 1) * 0.01);
      this.snapService.restoreSnappedDecorations([
        { object: instance, info: adjustedInfo },
      ]);
    } else {
      const offset = this.computePasteOffset(pasteCount + 1);
      const finalPosition = worldPosition.clone().add(offset);
      instance.position.copy(finalPosition);
      instance.quaternion.copy(worldQuaternion);
      instance.userData['isSnapped'] = false;
      instance.updateMatrixWorld(true);
    }

    instance.updateMatrixWorld(true);

    this.transformControlsService.attachObject(instance);
    this.clipboard.pasteCount += 1;

    this.paintService.registerDecorationAddition(instance);

    this.emitOutlineChanged();

    return {
      success: true,
      message: 'Skopiowana dekoracja została wklejona.',
    };
  }

  public hasCopiedDecoration(): boolean {
    return this.clipboard !== null;
  }

  public validateDecorations(): DecorationValidationIssue[] {
    const decorations = this.collectDecorationRoots();
    return this.snapService.validateDecorations(decorations);
  }

  public selectDecorationAt(clientX: number, clientY: number): THREE.Object3D | null {
    return this.handleInteraction(clientX, clientY, true);
  }

  public isSelectedDecorationSnapped(): boolean {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected || !this.cakeBase) {
      return false;
    }

    return selected.parent === this.cakeBase || selected.userData['isSnapped'] === true;
  }

  public isSelectedDecorationLocked(): boolean {
    return this.transformControlsService.isSelectionLocked();
  }

  public lockSelectedDecoration(): { success: boolean; message: string } {
    const result = this.transformControlsService.lockSelectedObject();
    if (result.success) {
      this.updateBoxHelper();
    }
    return result;
  }

  public unlockSelectedDecoration(): { success: boolean; message: string } {
    const result = this.transformControlsService.unlockSelectedObject();
    if (result.success) {
      this.updateBoxHelper();
    }
    return result;
  }

  public getSelectedDecoration(): THREE.Object3D | null {
    return this.transformControlsService.getSelectedObject();
  }

  public getSelectedDecorationId(): string | null {
    return this.transformControlsService.getSelectedObject()?.uuid ?? null;
  }

  public selectDecorationById(id: string): boolean {
    const target = this.findDecorationById(id);
    if (!target) {
      return false;
    }

    this.transformControlsService.attachObject(target);
    this.showBoxHelperFor(target);
    const modelId = (target.userData['modelFileName'] as string | undefined) ?? null;
    this.anchorPresetsService.setHighlightedDecoration(modelId);
    return true;
  }

  public frameSelection(): { success: boolean; message: string } {
    const selection = this.transformControlsService.getSelectedObject();
    if (!selection) {
      return { success: false, message: 'Brak zaznaczonego obiektu do wycentrowania.' };
    }

    this.frameObject(selection);
    return { success: true, message: 'Wycentrowano widok na zaznaczeniu.' };
  }

  public frameCake(): { success: boolean; message: string } {
    if (!this.cakeBase) {
      return { success: false, message: 'Brak tortu do wycentrowania.' };
    }

    this.frameObject(this.cakeBase);
    return { success: true, message: 'Widok ustawiony na tort.' };
  }

  public frameSelectionOrCake(): { success: boolean; message: string } {
    const selection = this.transformControlsService.getSelectedObject();
    if (selection) {
      return this.frameSelection();
    }

    return this.frameCake();
  }

  public setDecorationVisibility(id: string, visible: boolean): boolean {
    const target = this.findDecorationById(id);
    if (!target) {
      return false;
    }

    target.visible = visible;
    target.traverse((child) => {
      child.visible = visible;
    });

    this.emitOutlineChanged();
    return true;
  }

  public removeDecorationById(id: string): boolean {
    const target = this.findDecorationById(id);
    if (!target) {
      return false;
    }

    if (this.transformControlsService.getSelectedObject()?.uuid === id) {
      this.transformControlsService.deselectObject();
      this.hideBoxHelper();
    }

    this.removeDecoration(target);
    return true;
  }

  public groupDecorationsByIds(ids: string[], groupName?: string): { success: boolean; message: string; groupId?: string } {
    const uniqueIds = Array.from(new Set(ids));
    const decorations = uniqueIds
      .map((id) => this.findDecorationById(id))
      .filter((object): object is THREE.Object3D => Boolean(object));

    if (decorations.length < 2) {
      return { success: false, message: 'Wybierz co najmniej dwie dekoracje do zgrupowania.' };
    }

    const parent = decorations[0]?.parent ?? this.scene;
    const incompatibleParent = decorations.some((object) => object.parent !== parent);
    if (incompatibleParent) {
      return { success: false, message: 'Wszystkie dekoracje muszą mieć tego samego rodzica, aby utworzyć grupę.' };
    }

    const group = new THREE.Group();
    group.name = groupName?.trim() || 'Grupa dekoracji';
    group.userData['isDecoration'] = true;
    group.userData['isDecorationGroup'] = true;
    group.userData['displayName'] = group.name;

    parent?.add(group);
    decorations.forEach((object) => {
      group.add(object);
      this.objects = this.objects.filter((entry) => entry !== object);
    });

    this.objects.push(group);
    this.transformControlsService.attachObject(group);
    this.emitOutlineChanged();

    return { success: true, message: 'Utworzono nową grupę dekoracji.', groupId: group.uuid };
  }

  public getSceneOutline(): SceneOutlineNode {
    const rootId = this.cakeBase?.uuid ?? 'cake-root';
    const root: SceneOutlineNode = {
      id: rootId,
      name: 'Tort',
      type: 'cake',
      attached: true,
      visible: true,
      parentId: null,
      layerIndex: null,
      surface: null,
      children: [],
    };

    const unattachedRoot: SceneOutlineNode = {
      id: 'unattached-root',
      name: 'Nieprzyczepione',
      type: 'layer',
      attached: false,
      visible: true,
      parentId: rootId,
      layerIndex: null,
      surface: null,
      children: [],
    };

    const nodes = new Map<string, SceneOutlineNode>();
    nodes.set(rootId, root);
    nodes.set(unattachedRoot.id, unattachedRoot);

    const appendNode = (node: SceneOutlineNode, parentId: string | null) => {
      const parent = (parentId ? nodes.get(parentId) : null) ?? root;
      nodes.set(node.id, node);
      node.parentId = parent.id;
      parent.children.push(node);
    };

    const processDecoration = (object: THREE.Object3D) => {
      if (!this.isDecorationNode(object)) {
        object.children.forEach(processDecoration);
        return;
      }

      if (this.findParentDecoration(object)) {
        return;
      }

      const attached = this.isAttachedToCake(object);
      const snapInfo = this.findSnapInfo(object);
      const surface = snapInfo?.surfaceType ?? null;
      const parentId = attached ? rootId : unattachedRoot.id;

      const node: SceneOutlineNode = {
        id: object.uuid,
        name: this.describeDecoration(object),
        type: this.resolveDecorationType(object),
        attached,
        visible: object.visible,
        parentId,
        layerIndex: null,
        surface: surface ?? null,
        children: [],
      };

      appendNode(node, parentId);
    };

    const sceneChildren = this.sceneInitService.scene?.children ?? [];
    sceneChildren.forEach(processDecoration);

    root.children.push(unattachedRoot);

    return root;
  }

  public listDecorationsWithMetadata(): SceneOutlineNode[] {
    const outline = this.getSceneOutline();
    const flattened: SceneOutlineNode[] = [];

    const collect = (node: SceneOutlineNode) => {
      if (node.type !== 'cake' && node.type !== 'layer') {
        flattened.push(node);
      }

      node.children.forEach(collect);
    };

    outline.children.forEach(collect);
    return flattened;
  }

  public deselectDecoration(): boolean {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return false;
    }

    this.transformControlsService.deselectObject();
    this.hideBoxHelper();
    this.anchorPresetsService.setHighlightedDecoration(null);
    return true;
  }

  public resetCameraView(): void {
    this.sceneInitService.resetCameraView();
  }

  public snapSelectedDecorationToCake(): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    const result = this.snapService.snapDecorationToCake(selected);
    if (result.success) {
      this.updateBoxHelper();
    }

    return { success: result.success, message: result.message };
  }

  public snapSelectedDecorationToSurface(surface: 'TOP' | 'SIDE'): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    const result = this.snapService.snapDecorationToCake(selected, surface);
    if (result.success) {
      this.updateBoxHelper();
    }

    return { success: result.success, message: result.message };
  }

  public async spawnDecorationAtAnchor(
    decorationId: string,
    anchorId: string,
  ): Promise<{ success: boolean; message: string }> {
    const decorationInfo = this.decorationsService.getDecorationInfo(decorationId);
    if (!decorationInfo) {
      return { success: false, message: 'Nie znaleziono dekoracji do umieszczenia na kotwicy.' };
    }

    const placement = this.prepareAnchorPlacement(anchorId);
    if ('error' in placement) {
      return { success: false, message: placement.error };
    }

    const { anchor } = placement;
    const existingOccupant = this.getAnchorOccupant(anchor.id);
    if (existingOccupant) {
      return { success: false, message: 'Ta kotwica jest już zajęta inną dekoracją.' };
    }
    const compatibilityError = this.validateAnchorCompatibility(
      anchor,
      decorationInfo.type,
      [decorationInfo.id, decorationInfo.modelFileName],
    );
    if (compatibilityError) {
      return { success: false, message: compatibilityError };
    }
    const decoration = await this.decorationsService.addDecorationFromModel(
      decorationId,
      this.scene,
      this.cakeBase,
      this.objects,
      anchor.surface,
      anchor.layerIndex,
    );

    if (!decoration) {
      return { success: false, message: 'Nie udało się wczytać dekoracji dla kotwicy.' };
    }

    if (anchor.defaultScale && anchor.defaultScale > 0) {
      decoration.scale.setScalar(anchor.defaultScale);
    }

    this.applyAnchorPlacement(decoration, anchor);

    this.paintService.registerDecorationAddition(decoration);
    this.emitOutlineChanged();

    return { success: true, message: 'Dekoracja umieszczona na kotwicy.' };
  }

  public moveSelectionToAnchor(anchorId: string): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    const placement = this.prepareAnchorPlacement(anchorId);
    if ('error' in placement) {
      return { success: false, message: placement.error };
    }

    const { anchor } = placement;
    const decorationType = selected.userData['decorationType'] as DecorationPlacementType | undefined;
    const decorationId =
      (selected.userData['modelFileName'] as string | undefined) ??
      (selected.userData['displayName'] as string | undefined) ??
      selected.name;

    const compatibilityError = this.validateAnchorCompatibility(anchor, decorationType, [decorationId]);
    if (compatibilityError) {
      return { success: false, message: compatibilityError };
    }
    const occupant = this.getAnchorOccupant(anchor.id);
    if (occupant && occupant !== selected) {
      return { success: false, message: 'Ta kotwica jest już zajęta inną dekoracją.' };
    }

    if (anchor.defaultScale && anchor.defaultScale > 0) {
      selected.scale.setScalar(anchor.defaultScale);
    }

    this.applyAnchorPlacement(selected, anchor);
    this.updateBoxHelper();

    return { success: true, message: 'Dekoracja przeniesiona na kotwicę.' };
  }

  public exportAnchorsFromSelection(): AnchorPoint[] {
    if (!this.cakeMetadata) {
      return [];
    }

    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return [];
    }

    const anchor = this.snapService.buildAnchorFromDecoration(
      selected,
      this.cakeMetadata,
      selected.uuid,
      (selected.userData['displayName'] as string | undefined) ?? selected.name,
    );

    return anchor ? [anchor] : [];
  }

  public exportAllAnchors(): AnchorPreset | null {
    if (!this.cakeMetadata) {
      return null;
    }

    const decorations = this.collectDecorationRoots();
    const anchors: AnchorPoint[] = [];

    decorations.forEach((decoration) => {
      const displayName = (decoration.userData['displayName'] as string | undefined) ?? decoration.name;
      const anchor = this.snapService.buildAnchorFromDecoration(
        decoration,
        this.cakeMetadata!,
        decoration.uuid,
        displayName,
      );

      if (anchor) {
        anchors.push(anchor);
      }
    });

    if (!anchors.length) {
      return null;
    }

    return {
      id: `preset-${Date.now()}`,
      name: 'Wszystkie sloty dekoracji',
      anchors,
    };
  }

  public buildCakePresetPayload(): { options: CakeOptions; metadata: CakeMetadata | null } {
    return {
      options: this.options,
      metadata: this.cakeMetadata,
    };
  }

  public buildDecoratedCakePreset(name = 'Preset tortu'): DecoratedCakePreset {
    const decorations = this.collectDecorationRoots();
    const payload: DecoratedCakePreset = {
      id: `cake-${Date.now()}`,
      name,
      options: this.cloneCakeOptions(this.options),
      decorations: [],
    };

    payload.paintStrokes = this.paintService.exportPaintStrokes(this.scene);
    payload.surfacePainting = this.surfacePainting.exportPaintingPreset();

    const baseWorldQuaternion = this.cakeBase?.getWorldQuaternion(new THREE.Quaternion());

    decorations.forEach((decoration) => {
      const modelFileName = (decoration.userData['modelFileName'] as string | undefined) ?? decoration.name;
      if (!modelFileName) {
        return;
      }

      const worldPosition = decoration.getWorldPosition(new THREE.Vector3());
      const localPosition = this.cakeBase
        ? this.cakeBase.worldToLocal(worldPosition.clone())
        : worldPosition;

      const worldQuaternion = decoration.getWorldQuaternion(new THREE.Quaternion());
      const localQuaternion = baseWorldQuaternion
        ? baseWorldQuaternion.clone().invert().multiply(worldQuaternion)
        : worldQuaternion;

      const snapInfo = this.snapService.getSnapInfoSnapshot(decoration);
      const entry: DecorationPresetEntry = {
        modelFileName,
        position: [localPosition.x, localPosition.y, localPosition.z],
        rotation: [localQuaternion.x, localQuaternion.y, localQuaternion.z, localQuaternion.w],
        scale: [decoration.scale.x, decoration.scale.y, decoration.scale.z],
        snapInfo: snapInfo ? this.cloneSnapInfo(snapInfo) : undefined,
        anchorId: decoration.userData['anchorId'] as string | undefined,
      };

      payload.decorations.push(entry);
    });

    return payload;
  }

  public buildAnchorPresetFromSelection(): AnchorPreset | null {
    if (!this.cakeMetadata) {
      return null;
    }

    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return null;
    }

    const displayName = (selected.userData['displayName'] as string | undefined) ?? selected.name;
    const anchor = this.snapService.buildAnchorFromDecoration(
      selected,
      this.cakeMetadata,
      selected.uuid,
      displayName,
    );

    if (!anchor) {
      return null;
    }

    return {
      id: `preset-${selected.uuid}`,
      name: `Sloty: ${displayName}`,
      anchors: [anchor],
    };
  }

  public async applyDecoratedCakePreset(preset: DecoratedCakePreset): Promise<void> {
    if (!preset?.options) {
      return;
    }

    this.transformControlsService.deselectObject();
    this.clearAllDecorations();

    const optionsClone = this.cloneCakeOptions(preset.options);
    this.updateCakeOptions(optionsClone);

    if (!preset.decorations?.length) {
      this.emitOutlineChanged();
      return;
    }

    const results = await Promise.all(
      preset.decorations.map((entry) => this.spawnDecorationFromPreset(entry)),
    );

    const snapStates: SnappedDecorationState[] = [];
    results.forEach((result) => {
      if (!result) {
        return;
      }

      const { object, snapInfo, anchorId } = result;
      if (snapInfo) {
        snapStates.push({ object, info: this.cloneSnapInfo(snapInfo) });
      }

      if (anchorId) {
        this.registerAnchorOccupant(anchorId, object);
      }
    });

    if (snapStates.length) {
      this.snapService.restoreSnappedDecorations(snapStates);
    }

    if (preset.paintStrokes?.length) {
      await this.paintService.restorePaintStrokes(preset.paintStrokes, this.scene);
    }

    if (preset.surfacePainting) {
      this.surfacePainting.restorePaintingPreset(preset.surfacePainting);
    }

    this.updateBoxHelper();
    this.emitOutlineChanged();
  }

  private prepareAnchorPlacement(
    anchorId: string,
  ): { anchor: AnchorPoint; projection: { position: THREE.Vector3; normal: THREE.Vector3 } } | { error: string } {
    if (!this.cakeBase || !this.cakeMetadata) {
      return { error: 'Brak tortu do umieszczenia dekoracji na kotwicy.' };
    }

    const anchor = this.anchorPresetsService.getAnchor(anchorId);
    if (!anchor) {
      return { error: 'Nie znaleziono wskazanej kotwicy.' };
    }

    const projection = this.snapService.projectAnchor(anchor, this.cakeMetadata);
    if (!projection) {
      return { error: 'Nie można obliczyć pozycji kotwicy dla bieżącego tortu.' };
    }

    return { anchor, projection };
  }

  private applyAnchorPlacement(object: THREE.Object3D, anchor: AnchorPoint): void {
    if (!this.cakeBase) {
      return;
    }

    const previousAnchorId = object.userData['anchorId'] as string | undefined;
    if (previousAnchorId && previousAnchorId !== anchor.id) {
      this.clearAnchorOccupant(previousAnchorId, object);
    }

    this.registerAnchorOccupant(anchor.id, object);
    this.snapService.attachDecorationToAnchor(object, anchor);
  }

  private getAnchorOccupant(anchorId: string): THREE.Object3D | null {
    const occupant = this.anchorOccupants.get(anchorId);
    if (!occupant) {
      return null;
    }

    const stillPresent = this.scene.getObjectById(occupant.id);
    if (!stillPresent) {
      this.anchorOccupants.delete(anchorId);
      return null;
    }

    return occupant;
  }

  private registerAnchorOccupant(anchorId: string, object: THREE.Object3D): void {
    const existing = object.userData['anchorId'] as string | undefined;
    if (existing && existing !== anchorId) {
      this.anchorOccupants.delete(existing);
    }

    this.anchorOccupants.forEach((candidate, id) => {
      if (candidate === object && id !== anchorId) {
        this.anchorOccupants.delete(id);
      }
    });

    object.userData['anchorId'] = anchorId;
    this.anchorOccupants.set(anchorId, object);
  }

  private clearAnchorOccupant(anchorId: string, object?: THREE.Object3D): void {
    const occupant = this.anchorOccupants.get(anchorId);
    if (occupant && object && occupant !== object) {
      return;
    }

    this.anchorOccupants.delete(anchorId);
    if (object && object.userData['anchorId'] === anchorId) {
      delete object.userData['anchorId'];
    }
  }

  private validateAnchorCompatibility(
    anchor: AnchorPoint,
    decorationType?: DecorationPlacementType,
    decorationIdentifiers: Array<string | undefined> = [],
  ): string | null {
    const allowedSurfaces = this.mapPlacementTypeToSurfaces(decorationType);
    if (allowedSurfaces.length && !allowedSurfaces.includes(anchor.surface)) {
      if (decorationType === 'TOP') {
        return 'Ta dekoracja może być umieszczona tylko na górze tortu.';
      }
      if (decorationType === 'SIDE') {
        return 'Ta dekoracja może być umieszczona tylko na boku tortu.';
      }
      return 'Ta dekoracja nie może być umieszczona na wybranej kotwicy.';
    }

    if (anchor.allowedDecorationIds?.length) {
      const candidates = decorationIdentifiers.filter((id): id is string => !!id);
      const matches = candidates.some((candidate) => anchor.allowedDecorationIds!.includes(candidate));
      if (!matches) {
        return 'Ta kotwica nie jest dostępna dla wybranej dekoracji.';
      }
    }

    return null;
  }

  private mapPlacementTypeToSurfaces(type?: DecorationPlacementType): Array<'TOP' | 'SIDE'> {
    if (type === 'TOP') {
      return ['TOP'];
    }
    if (type === 'SIDE') {
      return ['SIDE'];
    }
    return [];
  }

  public alignSelectedDecorationToSurface(): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    const result = this.snapService.alignDecorationToSurface(selected);
    if (result.success) {
      this.updateBoxHelper();
    }

    return result;
  }

  public rotateSelectedDecorationQuarter(direction: 1 | -1 = 1): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    const result = this.snapService.rotateDecorationQuarter(selected, direction);
    this.updateBoxHelper();
    return result;
  }

  public rotateSelectedDecorationHalf(): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    const result = this.snapService.rotateDecorationHalf(selected);
    this.updateBoxHelper();
    return result;
  }

  public rotateSelectedDecorationByDegrees(degrees: number): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    const result = this.snapService.rotateDecorationByDegrees(selected, degrees);
    this.updateBoxHelper();
    return result;
  }

  public resetSelectedDecorationOrientation(): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    this.snapService.resetDecorationOrientation(selected);
    this.updateBoxHelper();

    return {
      success: true,
      message: 'Dekoracja została ustawiona pionowo.',
    };
  }

  public detachSelectedDecorationFromCake(): { success: boolean; message: string } {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return { success: false, message: 'Najpierw zaznacz dekorację.' };
    }

    if (!selected.parent) {
      this.scene.add(selected);
    } else if (selected.parent !== this.scene) {
      this.scene.attach(selected);
    }

    this.snapService.clearSnapInfo(selected);
    this.updateBoxHelper();

    return {
      success: true,
      message: 'Dekoracja została odczepiona od tortu.',
    };
  }

  public buildValidationSummary(issues: DecorationValidationIssue[]): string {
    if (!issues.length) {
      return 'Wszystkie dekoracje znajdują się w dozwolonych miejscach.';
    }

    const lines = issues.map((issue, index) => {
      const name = this.describeDecoration(issue.object);
      const prefix = `${index + 1}. ${name} —`;

      switch (issue.reason) {
        case 'NO_CAKE':
          return `${prefix} brak tortu do walidacji.`;
        case 'TYPE_MISMATCH': {
          const expected = this.formatExpectedSurfaces(issue.expectedSurfaces);
          const found = this.describeSurface(issue.surfaceType);
          return `${prefix} oczekiwano pozycji na ${expected}, ale najbliższa powierzchnia to ${found}.`;
        }
        case 'OUTSIDE': {
          const distance = isFinite(issue.distance) ? issue.distance.toFixed(2) : 'nieznana';
          if (issue.surfaceType === 'NONE') {
            return `${prefix} dekoracja znajduje się zbyt daleko od tortu (odległość ${distance}).`;
          }
          const surface = this.describeSurface(issue.surfaceType);
          return `${prefix} jest zbyt daleko od ${surface} (odległość ${distance}).`;
        }
      }
    });

    return ['Znaleziono problemy z rozmieszczeniem dekoracji:', ...lines].join('\n');
  }

  private collectDecorationRoots(): THREE.Object3D[] {
    const result: THREE.Object3D[] = [];
    const visited = new Set<THREE.Object3D>();

    const traverse = (object: THREE.Object3D) => {
      for (const child of object.children) {
        if (child.userData['decorationType'] || child.userData['isPaintStroke'] || child.userData['isPaintDecoration']) {
          const root = this.resolveDecorationRoot(child);
          if (!visited.has(root)) {
            visited.add(root);
            result.push(root);
          }
        }
        traverse(child);
      }
    };

    traverse(this.scene);

    return result;
  }

  private findDecorationById(id: string): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;

    const search = (object: THREE.Object3D) => {
      if (object.uuid === id) {
        found = object;
        return;
      }

      object.children.forEach((child) => {
        if (!found) {
          search(child);
        }
      });
    };

    search(this.scene);
    return found;
  }

  private isDecorationNode(object: THREE.Object3D): boolean {
    return Boolean(
      object.userData['isDecorationGroup'] === true ||
      object.userData['isDecoration'] === true ||
      object.userData['decorationType'] ||
      object.userData['isPaintStroke'] === true ||
      object.userData['isPaintDecoration'] === true
    );
  }

  private findParentDecoration(object: THREE.Object3D): THREE.Object3D | null {
    let current = object.parent;
    while (current && current !== this.scene && current !== this.cakeBase) {
      if (this.isDecorationNode(current)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  private isAttachedToCake(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current === this.cakeBase) {
        return true;
      }
      if (current === this.scene) {
        return false;
      }
      current = current.parent ?? null;
    }
    return false;
  }

  private findSnapInfo(object: THREE.Object3D): SnapInfoSnapshot | null {
    const snapInfo = object.userData['snapInfo'] as SnapInfoSnapshot | undefined;
    if (snapInfo) {
      return snapInfo;
    }

    for (const child of object.children) {
      const nested = this.findSnapInfo(child);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  private resolveDecorationType(object: THREE.Object3D): 'group' | 'decoration' {
    const isGroup = object instanceof THREE.Group || object.userData['isDecorationGroup'] === true;
    return isGroup ? 'group' : 'decoration';
  }

  private layerNodeId(index: number): string {
    return `cake-layer-${index}`;
  }

  private describeLayer(index: number): string {
    const layerLabel = `Warstwa ${index + 1}`;
    const dimension = this.cakeMetadata?.layerDimensions[index];
    if (!dimension) {
      return layerLabel;
    }

    const size = dimension.size ?? 1;
    const formatted = size.toFixed(2);
    return `${layerLabel} (×${formatted})`;
  }

  private resolveDecorationRoot(object: THREE.Object3D): THREE.Object3D {
    let current: THREE.Object3D = object;

    while (current.parent && current.parent !== this.scene && current.parent !== this.cakeBase) {
      current = current.parent;
    }

    return current;
  }

  private describeDecoration(object: THREE.Object3D): string {
    if (object.userData['isPaintStroke']) {
      return object.userData['displayName'] || 'Ślad pisaka';
    }

    if (object.userData['isPaintDecoration']) {
      return object.userData['displayName'] || 'Dekoracja malowana';
    }

    const label =
      object.userData['displayName'] ||
      object.userData['modelFileName'] ||
      object.name;

    return label || 'Dekoracja';
  }

  private formatExpectedSurfaces(surfaces: Array<'TOP' | 'SIDE'>): string {
    if (surfaces.length === 0 || surfaces.length === 2) {
      return 'górze lub boku tortu';
    }

    return surfaces[0] === 'TOP' ? 'górze tortu' : 'boku tortu';
  }

  private describeSurface(surface: 'TOP' | 'SIDE' | 'NONE'): string {
    switch (surface) {
      case 'TOP':
        return 'górna powierzchnia tortu';
      case 'SIDE':
        return 'boczna ścianka tortu';
      default:
        return 'tort';
    }
  }

  private duplicateDecoration(object: THREE.Object3D): THREE.Object3D {
    const originalUserData = new Map<THREE.Object3D, any>();

    object.traverse((node) => {
      originalUserData.set(node, node.userData);
      node.userData = this.cloneUserData(node.userData);
    });

    const clone = object.clone(true);

    originalUserData.forEach((data, node) => {
      node.userData = data;
    });
    const meshes: THREE.Mesh[] = [];

    clone.traverse((node) => {
      node.userData = this.cloneUserData(node.userData);

      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;

        if (mesh.geometry) {
          mesh.geometry = mesh.geometry.clone();
        }

        const originalMaterial = mesh.material;
        if (Array.isArray(originalMaterial)) {
          mesh.material = originalMaterial.map((mat) => mat.clone()) as THREE.Material[];
        } else if (originalMaterial) {
          mesh.material = originalMaterial.clone();
        }

        meshes.push(mesh);
      }
    });

    if (meshes.length) {
      clone.userData['clickableMeshes'] = meshes;
    }

    delete clone.userData['snapInfo'];
    clone.userData['isSnapped'] = false;
    delete clone.userData['anchorId'];

    return clone;
  }

  private cloneUserData(source: any): Record<string, unknown> {
    if (!source || typeof source !== 'object') {
      return {};
    }

    return (this.sanitizeUserData(source, new WeakSet()) as Record<string, unknown>) ?? {};
  }

  private sanitizeUserData(value: any, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (value instanceof THREE.Object3D) {
      return undefined;
    }

    if (seen.has(value)) {
      return undefined;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      const arr: unknown[] = [];
      value.forEach((entry) => {
        const sanitized = this.sanitizeUserData(entry, seen);
        if (sanitized !== undefined) {
          arr.push(sanitized);
        }
      });
      return arr;
    }

    const result: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (key === 'paintParent') {
        return;
      }

      const sanitized = this.sanitizeUserData(entry, seen);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    });

    return result;
  }

  private cloneSnapInfo(info: SnapInfoSnapshot): SnapInfoSnapshot {
    return {
      layerIndex: info.layerIndex,
      surfaceType: info.surfaceType,
      normal: [info.normal[0], info.normal[1], info.normal[2]],
      offset: info.offset,
      roll: info.roll,
      rotation: info.rotation
        ? [info.rotation[0], info.rotation[1], info.rotation[2], info.rotation[3]]
        : undefined,
    };
  }

  private async spawnDecorationFromPreset(entry: DecorationPresetEntry): Promise<{
    object: THREE.Object3D;
    snapInfo: SnapInfoSnapshot | null;
    anchorId?: string;
  } | null> {
    const info = this.decorationsService.getDecorationInfo(entry.modelFileName);
    const modelFileName = info?.modelFileName ?? entry.modelFileName;
    const modelUrl = `/models/${modelFileName}`;

    try {
      const decoration = await DecorationFactory.loadDecorationModel(modelUrl);
      decoration.userData['decorationType'] = info?.type ?? 'BOTH';
      decoration.userData['isDecoration'] = true;
      decoration.userData['modelFileName'] = modelFileName;

      if (info?.initialRotation && !entry.rotation) {
        const [x, y, z] = info.initialRotation;
        decoration.rotation.set(
          THREE.MathUtils.degToRad(x ?? 0),
          THREE.MathUtils.degToRad(y ?? 0),
          THREE.MathUtils.degToRad(z ?? 0),
        );
      }

      if (entry.rotation) {
        decoration.quaternion.set(entry.rotation[0], entry.rotation[1], entry.rotation[2], entry.rotation[3]);
      }

      if (entry.scale) {
        decoration.scale.set(entry.scale[0], entry.scale[1], entry.scale[2]);
      } else if (info?.initialScale && info.initialScale > 0) {
        decoration.scale.setScalar(info.initialScale);
      }

      if (entry.position) {
        decoration.position.set(entry.position[0], entry.position[1], entry.position[2]);
      }

      if (info?.material) {
        this.decorationsService.applyMaterialOverrides(decoration, info.material);
      }

      if (this.cakeBase) {
        this.cakeBase.add(decoration);
      } else {
        this.scene.add(decoration);
      }
      this.objects.push(decoration);

      const snapInfo = entry.snapInfo ? this.cloneSnapInfo(entry.snapInfo) : null;
      if (!snapInfo && this.cakeBase) {
        this.cakeBase.attach(decoration);
      }

      if (entry.anchorId) {
        decoration.userData['anchorId'] = entry.anchorId;
      }

      return { object: decoration, snapInfo, anchorId: entry.anchorId };
    } catch (error) {
      console.error('Nie udało się wczytać dekoracji z presetu:', error);
      return null;
    }
  }

  private cloneCakeOptions(options: CakeOptions): CakeOptions {
    return JSON.parse(JSON.stringify(options));
  }

  private computePasteOffset(step: number): THREE.Vector3 {
    const distance = 0.5;
    return new THREE.Vector3(distance * step, 0, distance * step);
  }

  private disposeObjectResources(object: THREE.Object3D): void {
    const meshLike = object as any;

    const geometry = meshLike.geometry as THREE.BufferGeometry | undefined;
    if (geometry && typeof geometry.dispose === 'function') {
      geometry.dispose();
    }

    const material = meshLike.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((mat) => mat?.dispose());
    } else if (material && typeof material.dispose === 'function') {
      material.dispose();
    }
  }

  private isPaintable(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;

    while (current) {
      if (current.userData['isCakeGlaze'] || current.userData['isCakeWafer']) {
        return false;
      }
      if (current.userData['isCakeLayer']) {
        return true;
      }

      if (current.name === 'CakeBase') {
        return false;
      }

      current = current.parent;
    }

    return false;
  }

  private pickPaintableHit(intersects: THREE.Intersection[]): THREE.Intersection | null {
    if (!intersects.length) return null;
    return intersects.find((intersection) => !this.isPaintStroke(intersection.object)) ?? intersects[0];
  }

  private isPaintStroke(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData?.['isPaintStroke']) {
        return true;
      }
      current = current.parent ?? null;
    }
    return false;
  }
}
