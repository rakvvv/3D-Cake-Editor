import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { FontLoader, Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TransformControlsService } from './transform-controls-service';
import { CakeOptions } from '../models/cake.options';
import { SceneInitService } from './scene-init.service';
import { DecorationsService } from './decorations.service';
import { PaintService } from './paint.service';
import { ExportService } from './export.service';
import { ThreeObjectsFactory, CakeMetadata } from '../factories/three-objects.factory';
import { TextFactory } from '../factories/text.factory';
import { SnapService, SnappedDecorationState, SnapInfoSnapshot } from './snap.service';
import { DecorationValidationIssue } from '../models/decoration-validation';

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
  private textMesh: THREE.Mesh | null = null;
  private font: Font | null = null;
  private options!: CakeOptions;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private boxHelper: THREE.BoxHelper | null = null;
  private clipboard: DecorationClipboardEntry | null = null;



  constructor(
    private http: HttpClient,
    private transformControlsService: TransformControlsService,
    private sceneInitService: SceneInitService,
    private decorationsService: DecorationsService,
    private paintService: PaintService,
    private exportService: ExportService,
    private snapService: SnapService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  public get scene(): THREE.Scene {
    return this.sceneInitService.scene;
  }

  public get camera(): THREE.PerspectiveCamera {
    return this.sceneInitService.camera;
  }

  public get renderer(): THREE.WebGLRenderer {
    return this.sceneInitService.renderer;
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

    const grid = new THREE.GridHelper(50, 50);
    this.scene.add(grid);

    this.rebuildCake();

    if (this.options.cake_text) {
      const textSize = this.getCakeHorizontalSize() * 0.2;
      const textDepth = 0.1;
      const textHeight = this.getCakeTopHeight();
      this.loadAndAddText(this.options.cake_text_value, textSize, textHeight, textDepth);
    }

    container.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }

      if (this.paintService.paintMode && this.cakeBase) {
        const rect = this.renderer.domElement.getBoundingClientRect();
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
      } else {
        this.onClickDown(event);
      }
    });

    container.addEventListener('mousemove', (event) => {
      if (!this.paintService.paintMode || !this.paintService.isPainting || !this.cakeBase) {
        return;
      }

      if (event.buttons !== undefined && (event.buttons & 1) === 0) {
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
    });

    const stopPainting = () => this.stopPaintingStroke();
    container.addEventListener('mouseup', stopPainting);
    container.addEventListener('mouseleave', stopPainting);
    container.addEventListener('contextmenu', (event) => {
      const painting = this.paintService.paintMode && this.paintService.isPainting;
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

      const key = event.key.toLowerCase();
      const wantsUndo = key === 'z' && !event.shiftKey;
      const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);

      if (wantsUndo) {
        if (this.paintService.canUndo()) {
          this.paintService.undo();
          event.preventDefault();
        }
      } else if (wantsRedo) {
        if (this.paintService.canRedo()) {
          this.paintService.redo();
          event.preventDefault();
        }
      }
    });
  }

  private stopPaintingStroke(): void {
    this.paintService.endStroke();
    this.sceneInitService.setOrbitEnabled(true);
  }

  public updateCakeOptions(options: CakeOptions): void {
    this.options = options;
    this.rebuildCake();

    if (options.cake_text) {
      const textSize = this.getCakeHorizontalSize() * 0.2;
      const textDepth = 0.1;
      const textHeight = this.getCakeTopHeight();
      this.loadAndAddText(options.cake_text_value, textSize, textHeight, textDepth);
    } else {
      this.removeCakeText();
    }

    const effectiveSize = this.cakeMetadata ? this.cakeMetadata.totalHeight * options.cake_size : options.cake_size;
    this.transformControlsService.updateCakeSize(effectiveSize);
    this.sceneInitService.updateOrbitForCake(effectiveSize);
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

    this.applyCakeTransforms();

    this.scene.add(cake);
    this.objects.push(cake);
    this.snapService.setCakeBase(cake);
    const effectiveSize = this.cakeMetadata ? this.cakeMetadata.totalHeight * this.options.cake_size : this.options.cake_size;
    this.transformControlsService.updateCakeSize(effectiveSize);
    this.sceneInitService.updateOrbitForCake(effectiveSize);

    if (snappedState.length) {
      this.snapService.restoreSnappedDecorations(snappedState);
      this.updateBoxHelper();
    }
  }

  private disposeCake(): void {
    if (!this.cakeBase) {
      return;
    }

    const children = [...this.cakeBase.children];
    children.forEach((child) => {
      if (!child.userData['isCakeLayer']) {
        this.scene.attach(child);
        child.userData['isSnapped'] = false;
      }
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

    this.cakeBase = null;
    this.cakeLayers = [];
    this.cakeMetadata = null;
    this.snapService.setCakeBase(null);
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
    this.textMesh.geometry.dispose();
    (this.textMesh.material as THREE.Material).dispose();
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

  private async loadFont(): Promise<void> {
    if (this.font) return;
    return new Promise((resolve, reject) => {
      const loader = new FontLoader();
      loader.load(
        '/fonts/helvetiker_regular.typeface.json',
        (font) => {
          this.font = font;
          console.log('Font załadowany', font);
          resolve();
        },
        undefined,
        (err) => {
          console.error('Błąd ładowania czcionki:', err);
          reject(err);
        }
      );
    });
  }

  private async loadAndAddText(text: string, size: number, height: number, depth: number): Promise<void> {
    if (!this.font) {
      await this.loadFont();
    }
    if (!this.font) {
      console.error('Font nie został załadowany');
      return;
    }
    const newTextMesh = TextFactory.createTextMesh(this.font, text, {
      size,
      depth,
      curveSegments: 12,
    });
    newTextMesh.position.set(0, height + 0.02, 0);
    newTextMesh.rotation.x = -0.5 * Math.PI;
    this.scene.add(newTextMesh);
    this.textMesh = newTextMesh;
  }
  // TODO zapisanie sceny lokalnie
  public getSceneConfiguration(): any {
    return this.objects.map((obj, index) => ({
      id: index,
      position: obj.position.toArray()
    }));
  }

  // TODO zrobic zapisywanie modelu
  public saveSceneConfiguration(data: any): Observable<any> {
    return this.http.post('/api/saveScene', data);
  }

  public async addDecorationFromModel(identifier: string): Promise<void> {
    if (!this.cakeBase) {
      return;
    }

    const decoration = await this.decorationsService.addDecorationFromModel(
      identifier,
      this.scene,
      this.cakeBase,
      this.objects
    );
    if (decoration) {
      this.showBoxHelperFor(decoration);
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

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      this.objects.filter((obj) => obj !== this.cakeBase && !obj.userData['isPainted']),
      true,
    );

    if (intersects.length === 0) {
      if (attach) {
        this.transformControlsService.deselectObject();
        this.hideBoxHelper();
      }
      return null;
    }

    let selected = intersects[0].object;
    while (selected.parent && selected.parent !== this.scene && selected.parent !== this.cakeBase) {
      selected = selected.parent;
    }

    if (selected === this.cakeBase) {
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
      this.showBoxHelperFor(selected);
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
    this.hideBoxHelper(); // Usuń stary
    this.boxHelper = new THREE.BoxHelper(object, 0xff0000); // Czerwony kolor
    this.boxHelper.layers.set(1);
    this.scene.add(this.boxHelper);
    // Aktualizuj BoxHelper, gdy obiekt się porusza (w TransformControlsService)
  }

  private hideBoxHelper(): void {
    if (this.boxHelper) {
      this.scene.remove(this.boxHelper);
      this.boxHelper.dispose(); // Zwolnij zasoby
      this.boxHelper = null;
    }
  }

  public updateBoxHelper(): void {
    if (this.boxHelper && this.transformControlsService.getSelectedObject()) {
      this.boxHelper.update();
    } else {
      this.hideBoxHelper(); // Ukryj, jeśli nic nie jest zaznaczone
    }
  }
  // --- Koniec funkcji BoxHelper ---

  public removeDecoration(object: THREE.Object3D): void {
    if (!object) {
      return;
    }

    if (this.cakeBase && object.parent === this.cakeBase) {
      this.scene.attach(object);
    }

    this.scene.remove(object);
    this.objects = this.objects.filter((entry) => entry !== object);

    object.traverse((child) => {
      this.snapService.clearSnapInfo(child);
      this.disposeObjectResources(child);
    });
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
    this.showBoxHelperFor(instance);
    this.clipboard.pasteCount += 1;

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

  public getSelectedDecoration(): THREE.Object3D | null {
    return this.transformControlsService.getSelectedObject();
  }

  public deselectDecoration(): boolean {
    const selected = this.transformControlsService.getSelectedObject();
    if (!selected) {
      return false;
    }

    this.transformControlsService.deselectObject();
    this.hideBoxHelper();
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
        if (child.userData['decorationType']) {
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

  private resolveDecorationRoot(object: THREE.Object3D): THREE.Object3D {
    let current: THREE.Object3D = object;

    while (current.parent && current.parent !== this.scene && current.parent !== this.cakeBase) {
      current = current.parent;
    }

    return current;
  }

  private describeDecoration(object: THREE.Object3D): string {
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
    const clone = object.clone(true);
    const meshes: THREE.Mesh[] = [];

    clone.traverse((node) => {
      node.userData = { ...node.userData };

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

    return clone;
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
}
