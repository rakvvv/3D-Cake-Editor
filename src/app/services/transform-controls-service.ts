import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { isPlatformBrowser } from '@angular/common';
import { ThreeObjectsFactory } from './three-objects.factory';
import { ThreeSceneService } from './three-scene.service';

@Injectable({
  providedIn: 'root',
})
export class TransformControlsService {
  private transformControls!: TransformControls;
  private selectedObject: THREE.Object3D | null = null;
  private scene!: THREE.Scene;
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;
  private orbit!: OrbitControls;
  private cakeSize = 1;
  private previousPosition!: THREE.Vector3;
  private cakeBase: THREE.Object3D | null = null;
  private readonly snapDistanceThreshold = 1.5; // Jak blisko musi być obiekt, by próbować przyciągnąć
  private readonly detachDistanceThreshold = 2.0; // Jak daleko odsunąć, by odczepić
  private readonly cakeSurfaceOffset = 0.05; // Mały offset od powierzchni tortu dla przyczepionych obiektów
  private raycaster = new THREE.Raycaster(); // Do sprawdzania odległości od tortu
  private boxHelperCallback: (() => void) | null = null; // Callback do aktualizacji BoxHelper
  private isBrowser: boolean;
  private radiusDebugMarker: THREE.Mesh | null = null;

  constructor(
    @Inject(PLATFORM_ID)
    private platformId: Object,
    ) {this.isBrowser = isPlatformBrowser(this.platformId);}

  public init(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, orbit: OrbitControls,  boxHelperUpdateCallback?: () => void ): void {
    if (!this.isBrowser) return;


    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.orbit = orbit
    this.boxHelperCallback = boxHelperUpdateCallback || null; // Zapisz callback

    orbit.addEventListener('change', () => {
      this.renderer.render(this.scene, this.camera);
    });

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.space = 'local'; // <-- DODAJ TĘ LINIĘ


    this.transformControls.addEventListener('change', this.onTransformChange);
    this.transformControls.addEventListener('dragging-changed', this.onDraggingChanged);
    this.transformControls.addEventListener('mouseDown', this.onMouseDown); // Do zapisu pozycji początkowej
    this.transformControls.addEventListener('mouseUp', this.onMouseUp); // Do finalizacji snapowania po puszczeniu myszy

    const gizmo = this.transformControls.getHelper();
		this.scene.add(gizmo);


    window.addEventListener('keydown', this.onKeyDown); // Przeniesiono tutaj dla spójności
  }

  public updateCakeSize(size: number): void {
    this.cakeSize = size;
  }

  private onTransformChange = () => {
    // Wywołanie renderowania jest ważne dla płynności
    this.renderer.render(this.scene, this.camera);

    if (this.boxHelperCallback) {
      this.boxHelperCallback(); // Aktualizuj BoxHelper
    }

    if (this.selectedObject && this.transformControls.dragging) {
      if (this.selectedObject.userData['isSnapped'] && this.selectedObject.parent === this.cakeBase) {
        // Jeśli jest przyczepiony, ogranicz ruch i sprawdź odczepienie
        this.constrainMovement();
        this.checkDetachment();
      } else if (!this.selectedObject.userData['isSnapped']) {
        // Jeśli nie jest przyczepiony, sprawdź czy jest blisko tortu
        this.checkProximityAndPotentialSnap();
      }
    }
  }

  private onDraggingChanged = (event: THREE.Event) => { // Użyj bardziej ogólnego typu THREE.Event w sygnaturze
    // Użyj asercji typu, aby uzyskać dostęp do 'value'
    const draggingValue = (event as THREE.Event & { value: boolean }).value;
    // Lub mniej bezpiecznie, ale krócej: const draggingValue = (event as any).value as boolean;

    console.log("Dragging changed, value:", draggingValue); // Log dla debugowania
    this.orbit.enabled = !draggingValue; // Użyj wartości uzyskanej przez asercję

    // Sprawdź próbę snapowania PO zakończeniu przeciągania (gdy draggingValue jest false)
    if (!draggingValue && this.selectedObject && !this.selectedObject.userData['isSnapped']) {
      console.log("Zakończono przeciąganie, próba snapowania...");
      this.attemptSnapSelectionToCake();
    }
  }


  private onMouseDown = () => {
    if (this.selectedObject && this.selectedObject.parent === this.cakeBase) {
      // Zapisz lokalną pozycję startową przyczepionego obiektu
      this.previousPosition.copy(this.selectedObject.position);
    }
  }

  private onMouseUp = () => {
    // Po puszczeniu myszki, jeśli obiekt jest blisko ale nie snapped, spróbuj snap
    if (this.selectedObject && !this.selectedObject.userData['isSnapped']) {
      this.attemptSnapSelectionToCake();
    }
  }

  // --- GŁÓWNA LOGIKA SNAPPINGU ---

  // Sprawdza bliskość i wizualnie podpowiada (np. zmiana koloru gizmo) - na razie bez implementacji wizualnej
  private checkProximityAndPotentialSnap(): void {
    if (!this.selectedObject || !this.cakeBase) return;

    const closestPointInfo = this.getClosestPointOnCake(this.selectedObject.position);

    if (closestPointInfo.distance < this.snapDistanceThreshold) {
      // Jest blisko - można by tu dodać wizualny wskaźnik
      // console.log("Blisko tortu!");
    } else {
      // Jest daleko
    }
  }

  // Próbuje przyczepić zaznaczony obiekt do tortu
  public attemptSnapSelectionToCake(): void {
    if (!this.selectedObject || !this.cakeBase || this.selectedObject.userData['isSnapped']) {
      console.log("Nie można przyczepić:", {selected: !!this.selectedObject, cake: !!this.cakeBase, snapped: this.selectedObject?.userData['isSnapped']});
      return;
    }


    const objectWorldPosition = this.selectedObject.getWorldPosition(new THREE.Vector3());
    const closestPointInfo = this.getClosestPointOnCake(objectWorldPosition);

    console.log("Próba przyczepienia, dystans:", closestPointInfo.distance, "threshold:", this.snapDistanceThreshold);


    if (closestPointInfo.distance < this.snapDistanceThreshold && closestPointInfo.surfaceType !== 'NONE') {
      const decorationType = this.selectedObject.userData['decorationType'];

      // Sprawdź czy typ dekoracji pasuje do typu powierzchni
      if ((decorationType === 'TOP' && closestPointInfo.surfaceType === 'TOP') ||
        (decorationType === 'SIDE' && closestPointInfo.surfaceType === 'SIDE'))
      {
        console.log(`Przyczepianie typu ${decorationType} do powierzchni ${closestPointInfo.surfaceType}`);
        this.snapObject(this.selectedObject, closestPointInfo);
      } else {
        console.log(`Typ dekoracji (${decorationType}) nie pasuje do typu powierzchni tortu (${closestPointInfo.surfaceType})`);
      }
    } else {
      console.log("Za daleko od tortu lub nie znaleziono powierzchni.");
    }
  }

  // Funkcja wykonująca faktyczne przyczepienie i ustawienie pozycji/rotacji
  private snapObject(object: THREE.Object3D, closestPointInfo: ClosestPointInfo): void {
    if (!this.cakeBase) return;

    const { point, normal, surfaceType } = closestPointInfo;
    const decorationType = object.userData['decorationType'];

    // 1. Zmień rodzica obiektu na cakeBase
    //    Musimy zachować transformację świata
    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = object.getWorldQuaternion(new THREE.Quaternion());

    this.cakeBase.attach(object); // To przeliczy lokalne koordynaty

    // 2. Oblicz docelową pozycję LOKALNĄ względem cakeBase
    const targetLocalPosition = point.clone(); // Punkt przecięcia jest już w lokalnych koordynatach cakeBase
    targetLocalPosition.addScaledVector(normal, this.cakeSurfaceOffset); // Odsuń lekko od powierzchni

    // 3. Oblicz docelową rotację LOKALNĄ względem cakeBase
    const targetQuaternion = new THREE.Quaternion();
    if (decorationType === 'TOP') {
      // Góra tortu - zazwyczaj płasko, skierowana w górę (oś Y tortu)
      // Zakładamy, że model jest orientowany tak, że jego 'góra' to +Y
      const up = new THREE.Vector3(0, 1, 0); // Oś Y w lokalnym układzie tortu
      targetQuaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up); // Domyślna orientacja
    } else { // SIDE
      // Bok tortu - obiekt ma być 'przyklejony' do boku, jego 'tył' ma być skierowany w stronę normalnej
      // Zakładamy, że 'przód' modelu to +Z, a 'góra' to +Y
      const objectForward = new THREE.Vector3(0, 0, 1); // Kierunek 'do przodu' modelu
      const objectUp = new THREE.Vector3(0, 1, 0);      // Kierunek 'w górę' modelu

      // Wektor kierunku "na zewnątrz" od tortu (normalna)
      const lookAtPosition = new THREE.Vector3().addVectors(targetLocalPosition, normal);
      const tempMatrix = new THREE.Matrix4();
      tempMatrix.lookAt(targetLocalPosition, lookAtPosition, objectUp); // Ustaw macierz patrzenia
      targetQuaternion.setFromRotationMatrix(tempMatrix);

      // Korekta - jeśli chcemy, żeby 'przód' modelu był skierowany 'na zewnątrz' tortu
      const desiredForward = normal.clone().negate(); // Chcemy patrzeć w stronę przeciwną do normalnej
      const right = new THREE.Vector3().crossVectors(objectUp, desiredForward).normalize();
      const correctedUp = new THREE.Vector3().crossVectors(desiredForward, right).normalize(); // Orto-normalizacja 'up'
      tempMatrix.makeBasis(right, correctedUp, desiredForward);
      targetQuaternion.setFromRotationMatrix(tempMatrix);
    }

    // 4. Zastosuj LOKALNĄ pozycję i rotację
    object.position.copy(targetLocalPosition);
    object.quaternion.copy(targetQuaternion);

    object.userData['isSnapped'] = true;
    console.log("Obiekt przyczepiony:", object.name, object.userData);
  }

  // Ogranicza ruch przyczepionego obiektu
  private constrainMovement(): void {
    if (!this.selectedObject || !this.cakeBase || this.selectedObject.parent !== this.cakeBase) return;

    const decorationType = this.selectedObject.userData['decorationType'];
    const mesh = this.cakeBase as THREE.Mesh;
    const cakeParams = (mesh.geometry as THREE.CylinderGeometry).parameters;

    // 1. Obliczenie efektywnych wymiarów tortu z uwzględnieniem skali
    // Wydaje się POPRAWNE - mnoży bazowy wymiar przez skalę
    const cakeRadius = cakeParams.radiusTop * this.cakeBase.scale.x;
    const cakeHeight = cakeParams.height * this.cakeBase.scale.y;

    // 2. Pobranie LOKALNEJ pozycji obiektu (względem tortu)
    const currentLocalPos = this.selectedObject.position; // To jest Vector3 pozycji lokalnej

    // Logowanie do debugowania - BARDZO WAŻNE TERAZ
    console.log('--- constrainMovement ---');
    console.log('Cake Scale:', this.cakeBase.scale.x.toFixed(2)); // Aktualna skala tortu
    console.log('Base Radius:', cakeParams.radiusTop); // Bazowy promień geometrii
    console.log('Calculated Cake Radius:', cakeRadius.toFixed(2)); // Obliczony promień z uwzględnieniem skali
    console.log('Local Pos BEFORE:', currentLocalPos.x.toFixed(2), currentLocalPos.y.toFixed(2), currentLocalPos.z.toFixed(2));

    if (decorationType === 'TOP') {
      const distanceToCenter = Math.sqrt(currentLocalPos.x * currentLocalPos.x + currentLocalPos.z * currentLocalPos.z);
      console.log('TOP - Distance to Center:', distanceToCenter.toFixed(2));

      if (distanceToCenter > cakeRadius) {
        const scaleFactor = cakeRadius / distanceToCenter;
        console.log('TOP - Exceeded radius, scaling by:', scaleFactor.toFixed(2));
        currentLocalPos.x *= scaleFactor;
        currentLocalPos.z *= scaleFactor;
      }
      // Ustawienie wysokości
      currentLocalPos.y = cakeHeight / 2 + this.cakeSurfaceOffset;

    } else { // SIDE
      const currentObjectRadius = Math.sqrt(currentLocalPos.x * currentLocalPos.x + currentLocalPos.z * currentLocalPos.z);
      console.log('SIDE - Current Object Radius:', currentObjectRadius.toFixed(2));

      if (Math.abs(currentObjectRadius - cakeRadius) > 0.01) { // Dopuszczamy mały błąd, aby uniknąć niepotrzebnego skalowania
        const scaleFactor = cakeRadius / currentObjectRadius;
        console.log('SIDE - Adjusting radius, scaling by:', scaleFactor.toFixed(2));
        currentLocalPos.x *= scaleFactor;
        currentLocalPos.z *= scaleFactor;
      }

      // Ograniczenie wysokości
      const minY = -cakeHeight / 2 + this.cakeSurfaceOffset;
      const maxY = cakeHeight / 2 - this.cakeSurfaceOffset;
      currentLocalPos.y = THREE.MathUtils.clamp(currentLocalPos.y, minY, maxY);

      // Aktualizacja rotacji (powinna być OK, używa już skorygowanych currentLocalPos)
      const normal = new THREE.Vector3(currentLocalPos.x, 0, currentLocalPos.z).normalize();
      const objectUp = new THREE.Vector3(0, 1, 0);
      const tempMatrix = new THREE.Matrix4();
      const desiredForward = normal.clone().negate();
      const right = new THREE.Vector3().crossVectors(objectUp, desiredForward).normalize();
      const correctedUp = new THREE.Vector3().crossVectors(desiredForward, right).normalize();
      tempMatrix.makeBasis(right, correctedUp, desiredForward);
      this.selectedObject.quaternion.setFromRotationMatrix(tempMatrix);
    }

    // 3. Zastosowanie skorygowanej LOKALNEJ pozycji
    this.selectedObject.position.copy(currentLocalPos);

    console.log('Local Pos AFTER:', currentLocalPos.x.toFixed(2), currentLocalPos.y.toFixed(2), currentLocalPos.z.toFixed(2));
    const worldPosAfter = this.selectedObject.getWorldPosition(new THREE.Vector3());
    console.log('World Pos AFTER:', worldPosAfter.x.toFixed(2), worldPosAfter.y.toFixed(2), worldPosAfter.z.toFixed(2));
    console.log('--- end constrainMovement ---');


  }

  // Sprawdza, czy obiekt został odsunięty wystarczająco daleko, by go odczepić
  private checkDetachment(): void {
    if (!this.selectedObject || !this.cakeBase || !this.selectedObject.userData['isSnapped']) return;

    const currentWorldPos = this.selectedObject.getWorldPosition(new THREE.Vector3());
    const closestPointInfo = this.getClosestPointOnCake(currentWorldPos);

    // Sprawdź dystans od *idealnej* powierzchni tortu
    if (closestPointInfo.distance > this.detachDistanceThreshold) {
      console.log("Odczepianie obiektu, dystans:", closestPointInfo.distance);
      this.detachObject(this.selectedObject);
    }
  }

  // Odczepia obiekt od tortu
  private detachObject(object: THREE.Object3D): void {
    if (!this.scene || object.parent !== this.cakeBase) return;

    // Zapisz transformacje świata PRZED zmianą rodzica
    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = object.getWorldQuaternion(new THREE.Quaternion());

    // Zmień rodzica na główną scenę
    this.scene.attach(object); // Przelicza koordynaty lokalne względem sceny

    // Przywróć zapisaną pozycję i rotację świata (teraz są to koordynaty lokalne sceny)
    object.position.copy(worldPosition);
    object.quaternion.copy(worldQuaternion);

    object.userData['isSnapped'] = false;
    console.log("Obiekt odczepiony:", object.name);
  }


  // --- FUNKCJE POMOCNICZE ---

  // Oblicza najbliższy punkt na powierzchni tortu (góra lub bok) do danego punktu w przestrzeni świata
  private getClosestPointOnCake(worldPoint: THREE.Vector3): ClosestPointInfo {
    const defaultResult: ClosestPointInfo = { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), distance: Infinity, surfaceType: 'NONE' };
    if (!this.cakeBase) return defaultResult;

    // Przekształć punkt świata do lokalnych koordynatów tortu
    const localPoint = this.cakeBase.worldToLocal(worldPoint.clone());

    const mesh = this.cakeBase as THREE.Mesh;
    const cakeParams = (mesh.geometry as THREE.CylinderGeometry).parameters;

    // --- POPRAWKA: Użyj przeskalowanych wymiarów ---
    const radius = cakeParams.radiusTop * this.cakeBase.scale.x; // Użyj skali X dla promienia
    const height = cakeParams.height * this.cakeBase.scale.y; // Użyj skali Y dla wysokości
    // --- KONIEC POPRAWKI ---
    const halfHeight = height / 2; // Użyj przeskalowanej połowy wysokości

    let closestPointLocal = new THREE.Vector3();
    let normalLocal = new THREE.Vector3();
    let distanceSq = Infinity;
    let surfaceType: 'TOP' | 'SIDE' | 'NONE' = 'NONE';

    // 1. Sprawdź górną powierzchnię (używając przeskalowanych wymiarów)
    const pointOnTopPlane = new THREE.Vector3(localPoint.x, halfHeight, localPoint.z); // Użyj scaled halfHeight
    const distToCenterSq = pointOnTopPlane.x * pointOnTopPlane.x + pointOnTopPlane.z * pointOnTopPlane.z;
    if (distToCenterSq <= radius * radius) { // Użyj scaled radius
      // Punkt jest nad górnym kołem
      const dSq = localPoint.distanceToSquared(pointOnTopPlane);
      if (dSq < distanceSq) {
        distanceSq = dSq;
        closestPointLocal.copy(pointOnTopPlane);
        normalLocal.set(0, 1, 0);
        surfaceType = 'TOP';
      }
    } else {
      // Punkt jest poza górnym kołem - najbliższy punkt na krawędzi górnej
      const scaleFactor = radius / Math.sqrt(distToCenterSq); // Użyj scaled radius
      const edgePoint = new THREE.Vector3(localPoint.x * scaleFactor, halfHeight, localPoint.z * scaleFactor); // Użyj scaled halfHeight
      const dSq = localPoint.distanceToSquared(edgePoint);
      if (dSq < distanceSq) {
        distanceSq = dSq;
        closestPointLocal.copy(edgePoint);
        normalLocal.set(edgePoint.x, 0, edgePoint.z).normalize(); // Normalna jak dla boku
        surfaceType = 'SIDE';
      }
    }

    // 2. Sprawdź boczną powierzchnię (używając przeskalowanych wymiarów)
    const pointOnAxis = new THREE.Vector3(0, THREE.MathUtils.clamp(localPoint.y, -halfHeight, halfHeight), 0); // Użyj scaled halfHeight
    const horizontalVec = new THREE.Vector3(localPoint.x, 0, localPoint.z);
    const distToAxis = horizontalVec.length();

    if (distToAxis > 0) {
      const pointOnSide = horizontalVec.setLength(radius).add(pointOnAxis); // Użyj scaled radius
      const dSq = localPoint.distanceToSquared(pointOnSide);

      if (dSq < distanceSq) {
        if (localPoint.y >= -halfHeight && localPoint.y <= halfHeight) { // Użyj scaled halfHeight
          distanceSq = dSq;
          closestPointLocal.copy(pointOnSide);
          normalLocal.set(localPoint.x, 0, localPoint.z).normalize();
          surfaceType = 'SIDE';
        }
      }
    } else {
      // Punkt na osi Y
      const closestY = THREE.MathUtils.clamp(localPoint.y, -halfHeight, halfHeight); // Use scaled halfHeight
      // Poprawka: Dla punktu na osi, najbliższy punkt na boku jest w dowolnym kierunku XZ o promieniu 'radius'
      const pointOnSideIfAxis = new THREE.Vector3(radius, closestY, 0); // Użyj scaled radius
      const dSq = localPoint.distanceToSquared(pointOnSideIfAxis);
      if (dSq < distanceSq) {
        distanceSq = dSq;
        closestPointLocal.copy(pointOnSideIfAxis);
        normalLocal.set(1, 0, 0); // Normalna np. w kierunku +X
        surfaceType = 'SIDE';
      }
    }

    // Zwróć wynik w lokalnych koordynatach cakeBase
    return {
      point: closestPointLocal,
      normal: normalLocal,
      distance: Math.sqrt(distanceSq),
      surfaceType: surfaceType
    };
  }


  // --- Pozostałe metody (attachObject, deselectObject, etc.) ---
  public attachObject(object: THREE.Object3D): void {
    if (this.selectedObject === object) return; // Już zaznaczony

    console.log('Przypinam obiekt do TransformControls:', object.name || object.type, object.userData); // Dodaj log userData
    this.deselectObject(); // Odłącz poprzedni, jeśli był

    this.selectedObject = object;
    this.transformControls.attach(this.selectedObject);
    // Resetuj stan snapowania przy nowym zaznaczeniu? Może nie, jeśli chcemy od razu móc przesuwać przyczepiony.
    // if (this.selectedObject.parent !== this.cakeBase) {
    //     this.selectedObject.userData.isSnapped = false;
    // }
  }

  public getSelectedObject(): THREE.Object3D | null {
    return this.selectedObject;
  }

  public deselectObject(): void {
    if (this.selectedObject) {
      // Nie resetuj userData.isSnapped tutaj, bo chcemy zachować stan przyczepienia
      console.log('Odpinam obiekt od TransformControls:', this.selectedObject.name || this.selectedObject.type);
      this.transformControls.detach();
      this.selectedObject = null;
      if (this.boxHelperCallback) {
        this.boxHelperCallback(); // Ukryj/aktualizuj BoxHelper
      }
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => { // Użyj arrow function dla `this`
    if (!this.selectedObject) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      console.log("Usuwanie obiektu:", this.selectedObject.name);
      // Odczep od tortu, jeśli jest przyczepiony
      if (this.selectedObject.parent === this.cakeBase) {
        this.detachObject(this.selectedObject); // Użyj detachObject, która przywraca do sceny
      }
      // Usuń obiekt ze sceny i listy obiektów
      this.scene.remove(this.selectedObject);
      // TODO: Musisz mieć sposób na usunięcie obiektu z listy `objects` w ThreeSceneService
      // Można to zrobić przez EventEmitter lub przekazanie callbacku
      // this.threeSceneService.removeObjectFromList(this.selectedObject); <--- Potrzebny mechanizm

      this.transformControls.detach(); // Odłącz gizmo
      this.selectedObject = null;
      if (this.boxHelperCallback) {
        this.boxHelperCallback(); // Ukryj BoxHelper
      }
    } else if (event.key === 'g') { // Klawisz 'G' do ręcznego przyczepienia
      console.log("Próba ręcznego przyczepienia (G)");
      this.attemptSnapSelectionToCake();
    } else if (event.key === 'd') { // Klawisz 'D' do ręcznego odczepienia
      console.log("Próba ręcznego odczepienia (D)");
      if (this.selectedObject && this.selectedObject.userData['isSnapped']) {
        this.detachObject(this.selectedObject);
      }
    }
  }

  public isDragging(): boolean {
    return this.transformControls?.dragging === true; // Dodano ?. dla bezpieczeństwa
  }

  // Metoda ustawiająca referencję do tortu
  public setCakeBase(cake: THREE.Object3D): void {
    this.cakeBase = cake;
  }

  // Metoda do czyszczenia przy niszczeniu komponentu
  public dispose(): void {
    if (!this.isBrowser) return;
    console.log("Czyszczenie TransformControlsService");
    window.removeEventListener('keydown', this.onKeyDown);
    this.transformControls.removeEventListener('change', this.onTransformChange);
    this.transformControls.removeEventListener('dragging-changed', this.onDraggingChanged);
    this.transformControls.removeEventListener('mouseDown', this.onMouseDown);
    this.transformControls.removeEventListener('mouseUp', this.onMouseUp);

    this.transformControls.dispose();

    this.selectedObject = null;
    this.cakeBase = null;
  }
}


interface ClosestPointInfo {
  point: THREE.Vector3;       // Najbliższy punkt na powierzchni tortu (w lokalnych koordynatach tortu)
  normal: THREE.Vector3;      // Normalna do powierzchni w tym punkcie (w lokalnych koordynatach tortu)
  distance: number;           // Odległość od oryginalnego punktu do najbliższego punktu na torcie
  surfaceType: 'TOP' | 'SIDE' | 'NONE'; // Typ powierzchni, na której znaleziono najbliższy punkt
}
