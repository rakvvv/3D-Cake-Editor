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



  constructor(
    private http: HttpClient,
    private transformControlsService: TransformControlsService,
    private sceneInitService: SceneInitService,
    private decorationsService: DecorationsService,
    private paintService: PaintService,
    private exportService: ExportService,
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

  public init(container: HTMLElement, options: CakeOptions): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.options = options;
    this.sceneInitService.init(container);
    this.transformControlsService.init(this.scene, this.camera, this.renderer, this.sceneInitService.orbit);

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
      if (this.paintService.paintMode && this.cakeBase) {
        this.paintService.isPainting = true;
        this.paintService.handlePaint(event, this.renderer, this.camera, this.scene, this.cakeBase, this.mouse, this.raycaster);
      } else {
        this.onClickDown(event);
      }
    });

    container.addEventListener('mousemove', (event) => {
      if (this.paintService.isPainting && this.paintService.paintMode && this.cakeBase) {
        this.paintService.handlePaint(event, this.renderer, this.camera, this.scene, this.cakeBase, this.mouse, this.raycaster);
      }
    });

    container.addEventListener('mouseup', () => {
      this.paintService.isPainting = false;
    });
  }

  public updateCakeOptions(options: CakeOptions): void {
    this.options = options;
    this.rebuildCake();

    if (options.cake_text) {
      const textSize = this.getCakeHorizontalSize() * 0.2;
      const textDepth = 0.1;
      const textHeight = this.getCakeTopHeight();
      this.loadAndAddText(options.cake_text_value, textSize, textHeight, textDepth);
      const effectiveSize = this.cakeMetadata ? this.cakeMetadata.totalHeight * options.cake_size : options.cake_size;
      this.transformControlsService.updateCakeSize(effectiveSize);
    } else {
      this.removeCakeText();
    }
  }

  private rebuildCake(): void {
    if (!this.scene) {
      return;
    }

    this.removeCakeText();
    this.disposeCake();

    const { cake, layers, metadata } = ThreeObjectsFactory.createCake(this.options);
    this.cakeBase = cake;
    this.cakeLayers = layers;
    this.cakeMetadata = metadata;

    this.applyCakeTransforms();

    this.scene.add(cake);
    this.objects.push(cake);
    this.transformControlsService.setCakeBase(cake);
    const effectiveSize = this.cakeMetadata ? this.cakeMetadata.totalHeight * this.options.cake_size : this.options.cake_size;
    this.transformControlsService.updateCakeSize(effectiveSize);
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
    this.transformControlsService.setCakeBase(null);
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

  private getCakeTopHeight(): number {
    if (!this.cakeMetadata) {
      return this.options.cake_size * 2;
    }

    return this.cakeMetadata.totalHeight * this.options.cake_size;
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
    if (this.transformControlsService.isDragging()) {
      return;
    }


    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      this.objects.filter(obj => obj !== this.cakeBase && !obj.userData['isPainted']),
      true
    );


    if (intersects.length > 0) {
      let selected = intersects[0].object;

      // Znajdź najwyższy kontener (Group)
      while (selected.parent && selected.parent.type !== 'Scene') {
        selected = selected.parent;
      }

      this.transformControlsService.attachObject(selected);
    } else {
      this.transformControlsService.deselectObject();
    }

    if (intersects.length > 0) {
      let selected = intersects[0].object;
      console.log("Raycast intersected with:", selected.name || selected.type, selected);
      while (selected.parent && selected.parent !== this.scene && selected.parent !== this.cakeBase) {
        selected = selected.parent;
      }
      console.log("Selected top-level object:", selected.name || selected.type);

      // --- Dodaj BoxHelper ---
      if (this.boxHelper) this.scene.remove(this.boxHelper); // Usuń stary helper
      this.boxHelper = new THREE.BoxHelper(selected, 0xff0000); // Czerwony kolor
      this.scene.add(this.boxHelper);
      console.log("Added BoxHelper for selected object.");
      // --- Koniec BoxHelper ---

      console.log("Attaching to TransformControls:", selected.name || selected.type);
      this.transformControlsService.attachObject(selected);
    } else {
      // ... (kod dla braku przecięcia) ...
      // Usuń helper, jeśli kliknięto w puste miejsce
      if (this.boxHelper) {
        this.scene.remove(this.boxHelper);
        this.boxHelper = null;
      }
      this.transformControlsService.deselectObject();
    }
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

  private handleInteraction(clientX: number, clientY: number): void {
    if (this.transformControlsService.isDragging()) {
      return; // Nie rób nic jeśli już przeciągamy obiekt za pomocą gizmo
    }

    // Przelicz współrzędne ekranowe na scenę
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    // Intersekcje tylko z dekoracjami (nie z tortem bazowym)
    const intersects = this.raycaster.intersectObjects(
      this.objects.filter(obj => obj !== this.cakeBase && !obj.userData['isPainted']),
      true
    );


    if (intersects.length > 0) {
      let selected = intersects[0].object;
      // Znajdź główny obiekt (Group), który dodaliśmy do sceny
      while (selected.parent && selected.parent !== this.scene) {
        selected = selected.parent;
      }
      console.log("Kliknięto obiekt:", selected.name || selected.type, selected.userData); // Dodaj log userData
      if (selected !== this.cakeBase && this.objects.includes(selected)) { // Upewnij się, że to obiekt z naszej listy
        this.transformControlsService.attachObject(selected);
        this.showBoxHelperFor(selected); // Pokaż BoxHelper
      } else {
        this.transformControlsService.deselectObject();
        this.hideBoxHelper();
      }

    } else {
      // Kliknięto w puste miejsce
      this.transformControlsService.deselectObject();
      this.hideBoxHelper();
    }
  }


  private onTouchStart(event: TouchEvent): void {
    // event.preventDefault(); // Może być potrzebne
    if (event.touches.length > 0) {
      this.handleInteraction(event.touches[0].clientX, event.touches[0].clientY);
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

  // Metoda publiczna do wywołania z komponentu (np. przyciskiem)
  // Zastępuje poprzednią implementację w komponencie
  public attachSelectedToCake(): void {
    this.transformControlsService.attemptSnapSelectionToCake();
  }

}
