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
import {Object3D, Object3DEventMap} from 'three';


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
  private boxHelper: THREE.BoxHelper | null = null;
  private decorationsInfo: Map<string, { modelFileName: string, type: 'SIDE' | 'TOP' }> = new Map(); // Przykładowe dane z API

  constructor(
    private http: HttpClient,
    private transformControlsService: TransformControlsService,
    @Inject(PLATFORM_ID) private platformId: Object
    ) {
    // TODO: Załaduj dane dekoracji z API np. w konstruktorze lub metodzie init
    this.loadDecorationsData();
  }

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

    container.addEventListener('mousedown', (event) => this.onClickDown(event), false); // false dla bubble phase

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

  public async addDecorationFromModel(identifier: string /* np. 'Numer_1.glb' lub ID */, options: CakeOptions): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Użyj 'let', aby umożliwić późniejsze przypisanie
    let decoInfo = this.decorationsInfo.get(identifier); // Pierwsza próba znalezienia po kluczu

    if (!decoInfo) {
      console.warn('Nie znaleziono informacji dla klucza:', identifier, ". Próba wyszukania wg nazwy pliku...");
      // Druga próba: Spróbuj znaleźć na podstawie nazwy pliku w wartościach mapy
      const possibleInfo = Array.from(this.decorationsInfo.values()).find(info => info.modelFileName === identifier);

      if (possibleInfo) {
        // Znaleziono! Przypisz znaleziony obiekt do decoInfo
        console.log("Znaleziono informacje wg nazwy pliku:", possibleInfo);
        decoInfo = possibleInfo; // <-- TUTAJ JEST POPRAWKA
      } else {
        // Nadal nie znaleziono po drugiej próbie
        console.error('Nie można znaleźć dekoracji o identyfikatorze/nazwie pliku:', identifier);
        return; // Zakończ, jeśli nie ma informacji
      }
    }

    // W tym momencie, jeśli nie wyszliśmy z funkcji, decoInfo POWINIEN być prawidłowym obiektem
    if (!decoInfo) {
      // Dodatkowe zabezpieczenie, chociaż teoretycznie nie powinno tu dojść
      console.error("Krytyczny błąd: decoInfo nadal jest niezdefiniowane po sprawdzeniu.");
      return;
    }

    const modelUrl = `/models/${decoInfo.modelFileName}`; // Ścieżka do modelu
    console.log(`Ładowanie dekoracji: ${identifier}, Typ: ${decoInfo.type}, URL: ${modelUrl}`);

    try {
      const decoration = await ThreeObjectsFactory.loadDecorationModel(modelUrl);

      // Przypisz dane do userData używając poprawnego obiektu decoInfo
      decoration.userData['decorationType'] = decoInfo.type; // Użyj notacji '.' jeśli to możliwe
      decoration.userData['modelFileName'] = decoInfo.modelFileName;
      decoration.userData['isSnapped'] = false; // Początkowo nie jest przyczepiona

      decoration.position.set(
        (Math.random() - 0.5) * 5, // Bliżej tortu na start
        this.cakeBase.position.y + (this.cakeBase.geometry as THREE.CylinderGeometry).parameters.height * this.cakeBase.scale.y + 2 + Math.random(), // Nad tortem
        (Math.random() - 0.5) * 5
      );
      // Dostosuj skalę, jeśli modele są zbyt duże/małe
      // decoration.scale.set(0.5, 0.5, 0.5);

      this.scene.add(decoration);
      this.objects.push(decoration); // Dodaj do listy obiektów klikalnych
      console.log('Dekoracja dodana:', decoration);

      // Opcjonalnie: Automatycznie zaznacz nowo dodany obiekt
      this.transformControlsService.attachObject(decoration);
      this.showBoxHelperFor(decoration); // Pokaż BoxHelper od razu

    } catch (error) {
      console.error(`Błąd ładowania dekoracji ${identifier}:`, error);
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

  private async loadDecorationsData(): Promise<void> {
    // W rzeczywistej aplikacji zrób zapytanie HTTP GET /api/decorations
    // Poniżej symulacja:
    try {
      // const decorationsFromApi = await this.http.get<any[]>('/api/decorations').toPromise();
      const decorationsFromApi = [
        { id: 1, name: "Cyfra 1", modelFileName: "Numer_1.glb", type: "TOP", thumbnailUrl: "..." },
        { id: 2, name: "Ozdoba Boczna", modelFileName: "custom.glb", type: "SIDE", thumbnailUrl: "..." },
      ];

      decorationsFromApi.forEach(dec => {
        // Używamy unikalnego identyfikatora (np. modelFileName lub ID z bazy) jako klucza
        this.decorationsInfo.set(dec.modelFileName, { modelFileName: dec.modelFileName, type: dec.type as ('SIDE' | 'TOP') });
      });
      console.log("Dane dekoracji załadowane:", this.decorationsInfo);
    } catch (error) {
      console.error("Błąd ładowania danych dekoracji z API:", error);
    }
  }

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
    const intersects = this.raycaster.intersectObjects(this.objects.filter(obj => obj !== this.cakeBase), true);

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
