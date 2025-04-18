import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ThreeObjectsFactory } from './three-objects.factory';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { FontLoader, Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { TransformControlsService } from './transform-controls-service';


export interface CakeOptions {
  cake_size: number;
  cake_color: string;
  cake_text: boolean;
  cake_text_value: string;
}

@Injectable({
  providedIn: 'root' // singleton (serwis dostępny przez całą aplikacje)
})
export class ThreeSceneService {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private orbit!: OrbitControls;
  private objects: THREE.Object3D[] = [];
  private cakeBase!: THREE.Mesh;
  private textMesh: THREE.Mesh | null = null;
  private font: Font | null = null;
  private options!: CakeOptions;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  constructor(
    private http: HttpClient,
    private transformControlsService: TransformControlsService,
    @Inject(PLATFORM_ID) private platformId: Object
    ) {}

  public init(container: HTMLElement, options: CakeOptions): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.options = options;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(-10, 30, 30);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enablePan = false;
    this.orbit.minDistance = 10;
    this.orbit.maxDistance = 50;

    this.transformControlsService.init(this.scene, this.camera, this.renderer, this.orbit); // opcje do kontroli objektami



    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(10, 20, 10);
    this.scene.add(directional);


    // gridhelper
    const grid = new THREE.GridHelper(50, 50);
    this.scene.add(grid);

    // Dodajemy podstawę tortu przy użyciu fabryki
    this.cakeBase = ThreeObjectsFactory.createCakeBase();
    this.scene.add(this.cakeBase);
    this.objects.push(this.cakeBase);

    this.transformControlsService.setCakeBase(this.cakeBase);

    // Zastosuj opcje
    this.updateCakeOptions(this.options);

    container.addEventListener('mousedown', (event) => this.onClickDown(event));

    this.animate();

    window.addEventListener('resize', () => {
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  public updateCakeOptions(options: CakeOptions): void {
    this.options = options;
    if (this.cakeBase) {
      // Ustaw skalę tortu
      this.cakeBase.scale.set(options.cake_size, options.cake_size, options.cake_size);
      this.cakeBase.position.set(0, options.cake_size, 0);
      // Ustaw kolor tortu – używamy asercji typu
      (this.cakeBase.material as THREE.MeshPhongMaterial).color.set(options.cake_color);

      if (options.cake_text) {
        // Usuń istniejący napis, jeśli istnieje
        if (this.textMesh) {
          this.scene.remove(this.textMesh);
          this.textMesh.geometry.dispose();
          (this.textMesh.material as THREE.Material).dispose();
          this.textMesh = null;
        }
        // Obliczenie wielkosci i pozycji napisu do wielksci tortu
        const params = (this.cakeBase.geometry as any).parameters;
        const size = params.radiusTop * 0.2 * options.cake_size;
        const height = params.height + 2 * (options.cake_size - 1);
        const depth = 0.1 ;
        this.loadAndAddText(options.cake_text_value, size, height, depth);
        this.transformControlsService.updateCakeSize(options.cake_size);
      } else {
        // Jeśli napis ma być wyłączony, usuń go, jeśli istnieje
        if (this.textMesh) {
          this.scene.remove(this.textMesh);
          this.textMesh.geometry.dispose();
          (this.textMesh.material as THREE.Material).dispose();
          this.textMesh = null;
        }
      }
    }
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
    const textGeometry = new TextGeometry(text, {
      font: this.font,
      size: size,
      depth: depth,
      curveSegments: 12
    });
    textGeometry.center();
    const textMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    const newTextMesh = new THREE.Mesh(textGeometry, textMaterial);
    newTextMesh.position.y = height;
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

  public async addDecorationFromModel(type: string, options: CakeOptions): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    console.log('addDecorationFromModel wywołana dla typu:', type);
    let modelUrl = '';
    if (type === 'Numer_1') {
      modelUrl = '/models/Numer_1.glb';
    } else if (type === 'custom') {
      modelUrl = '/models/custom.glb';
    }
    if (!modelUrl) {
      console.warn('Nieznany typ dekoracji:', type);
      return;
    }
    try {
      const decoration = await ThreeObjectsFactory.loadDecorationModel(modelUrl);
      decoration.position.set(
        (Math.random() - 0.5) * 10,
        3 + Math.random() * 2,
        (Math.random() - 0.5) * 10
      );
      this.scene.add(decoration);
      this.objects.push(decoration);
      console.log('Dekoracja dodana:', decoration);
    } catch (error) {
      console.error('Błąd ładowania dekoracji:', error);
    }
  }

  private onClickDown(event: MouseEvent): void {
    if (this.transformControlsService.isDragging()) {
      return;
    }

    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.objects.filter(obj => obj !== this.cakeBase), true);

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
  }

  public attachSelectedToCake(): void {
    const selected = this.transformControlsService.getSelectedObject();
    console.log("Wywołano attachSelectedToCake. Zaznaczony obiekt:", selected);
    if (!selected) {
      console.warn('Brak zaznaczonego obiektu!');
      return;
    }

    if (selected.parent === this.cakeBase) {
      console.log('Obiekt już jest przypięty do tortu.');
      return;
    }

    this.cakeBase.attach(selected);
  }


}
