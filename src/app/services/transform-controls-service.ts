import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { isPlatformBrowser } from '@angular/common';
import { ClosestPointInfo } from '../models/cake.points'


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
  private boxHelperCallback: (() => void) | null = null; // Callback do aktualizacji BoxHelper
  private isBrowser: boolean;


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
    this.transformControls.space = 'local';
    this.transformControls.mode = 'translate'; // Domyślny tryb transform controls


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
      if (this.selectedObject.userData['isSnapped'] && this.selectedObject.parent === this.cakeBase && this.transformControls.mode === 'translate' ) {
        // Jeśli jest przyczepiony, ogranicz ruch i sprawdź odczepienie
        this.constrainMovement();
        this.checkDetachment();
      } else if (!this.selectedObject.userData['isSnapped']) {
        // Jeśli nie jest przyczepiony, sprawdź czy jest blisko tortu
        this.checkProximityAndPotentialSnap();
      }
    }


  }
  public setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    if (this.transformControls) {
      this.transformControls.mode = mode;
      // this.transformControls.enabled = mode !== 'none'; // Włącz/wyłącz gizmo
      // this.orbit.enabled = mode === 'none'; // Wyłącz/włącz orbit controls

      console.log(`TransformControls mode set to: ${mode}, enabled: ${this.transformControls.enabled}`);
      this.renderer.render(this.scene, this.camera);  // Renderuj, żeby gizmo się zaktualizowało
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
    if (
      this.selectedObject &&
      this.selectedObject.userData['isSnapped'] &&
      this.transformControls.mode === 'rotate'
    ) {
      this.updateSnapRotationOffset(this.selectedObject);
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

    // 1. Zmień rodzica obiektu na cakeBase (zachowując globalną transformację)
    this.cakeBase.attach(object);

    // 2. Oblicz docelową pozycję LOKALNĄ
    const targetLocalPosition = point.clone();
    targetLocalPosition.addScaledVector(normal, this.cakeSurfaceOffset);
    object.position.copy(targetLocalPosition);

    // === NOWA LOGIKA ROTACJI PRZY PRZYCZEPIANIU ===
    const decorationType = object.userData['decorationType'];

    if (decorationType === 'SIDE') {
      // A. Zapisz oryginalną rotację obiektu w momencie przyczepiania
      const objectsOriginalQuaternion = object.quaternion.clone();

      // B. Oblicz bazową rotację (skierowaną na zewnątrz) w punkcie przyczepienia
      const baseNormal = new THREE.Vector3(targetLocalPosition.x, 0, targetLocalPosition.z).normalize();
      if (baseNormal.lengthSq() === 0) { baseNormal.set(1, 0, 0); } // Zabezpieczenie dla centrum
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, baseNormal).normalize();
      const correctedUp = new THREE.Vector3().crossVectors(baseNormal, right).normalize();
      const baseMatrix = new THREE.Matrix4().makeBasis(right, correctedUp, baseNormal);
      const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(baseMatrix);

      // C. Oblicz RÓŻNICĘ (offset) między oryginalną rotacją a bazową
      // To jest "własna" rotacja użytkownika, którą chcemy zachować
      const offsetQuaternion = baseQuaternion.clone().invert().multiply(objectsOriginalQuaternion);
      object.userData['snapOffsetQuaternion'] = offsetQuaternion; // Zapisz offset

      // D. Zastosuj połączoną rotację natychmiast
      object.quaternion.copy(baseQuaternion).multiply(offsetQuaternion);

    } else { // Dla dekoracji 'TOP'
      // Dla góry nie potrzebujemy skomplikowanej logiki, zachowujemy po prostu rotację obiektu
      // Można tu jawnie wyzerować offset na wszelki wypadek
      // Dla góry nie potrzebujemy skomplikowanej logiki, zachowujemy po prostu rotację obiektu
      // Można tu jawnie wyzerować offset na wszelki wypadek
      object.userData['snapOffsetQuaternion'] = new THREE.Quaternion(); // Reset
    }
    // ===============================================

    object.userData['isSnapped'] = true;
    console.log("Obiekt przyczepiony, offset rotacji zapisany.", object.userData);
  }

  private updateSnapRotationOffset(object: THREE.Object3D): void {
    if (!object || !this.cakeBase || !object.userData['isSnapped'] || object.userData['decorationType'] !== 'SIDE') {
      return;
    }
    console.log("Aktualizacja offsetu rotacji po obrocie przez użytkownika...");

    // Logika jest identyczna jak w snapObject:
    const localPos = object.position;
    const objectQuaternion = object.quaternion;

    const baseNormal = new THREE.Vector3(localPos.x, 0, localPos.z).normalize();
    if (baseNormal.lengthSq() === 0) { baseNormal.set(1, 0, 0); }
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, baseNormal).normalize();
    const correctedUp = new THREE.Vector3().crossVectors(baseNormal, right).normalize();
    const baseMatrix = new THREE.Matrix4().makeBasis(right, correctedUp, baseNormal);
    const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(baseMatrix);

    const offsetQuaternion = baseQuaternion.clone().invert().multiply(objectQuaternion);
    object.userData['snapOffsetQuaternion'] = offsetQuaternion;
  }



  // Ogranicza ruch przyczepionego obiektu
  private constrainMovement(): void {
    if (!this.selectedObject || !this.cakeBase || this.selectedObject.parent !== this.cakeBase) return;

    const worldPos = this.selectedObject.getWorldPosition(new THREE.Vector3());
    const localPos = this.cakeBase.worldToLocal(worldPos.clone());

    const decorationType = this.selectedObject.userData['decorationType'];
    const mesh = this.cakeBase as THREE.Mesh;
    const cakeParams = (mesh.geometry as THREE.CylinderGeometry).parameters;

    // Używamy nieskalowanych wymiarów tortu dla logiki ograniczeń lokalnych
    const cakeRadius = cakeParams.radiusTop;
    const cakeHeight = cakeParams.height;
    const halfH = cakeHeight / 2;

    // currentLocalPos to pozycja, którą użytkownik próbuje ustawić za pomocą gizma
    const currentLocalPos = this.selectedObject.position;
    const maxPenetrationDepth = 0.5; // Jak głęboko środek obiektu może wejść WZGLĘDEM powierzchni
    const maxLiftOffDistance = 0.1;  // Jak daleko środek obiektu może się unieść/odsunąć OD powierzchni

    const currR = Math.hypot(localPos.x, localPos.z);
    const clampedR = THREE.MathUtils.clamp(
      currR,
      cakeRadius - maxPenetrationDepth,
      cakeRadius + maxLiftOffDistance
    );
    if (currR > 0.001) {
      const s = clampedR / currR;
      localPos.x *= s;
      localPos.z *= s;
    }
    // pionowo
    localPos.y = THREE.MathUtils.clamp(localPos.y, -halfH + this.cakeSurfaceOffset, halfH - this.cakeSurfaceOffset);

    if (decorationType === 'TOP') {
      const distanceToCenter = Math.sqrt(currentLocalPos.x * currentLocalPos.x + currentLocalPos.z * currentLocalPos.z);

      // Ograniczenie radialne (XZ) - pozostaje bez zmian
      if (distanceToCenter > cakeRadius) {
        const scaleFactor = cakeRadius / distanceToCenter;
        // console.log('TOP - Exceeded radius, scaling by:', scaleFactor.toFixed(2));
        currentLocalPos.x *= scaleFactor;
        currentLocalPos.z *= scaleFactor;
      }

      // Ograniczenie wysokości (Y) - ZMODYFIKOWANE
      const cakeTopSurfaceY = cakeHeight / 2; // Pozycja Y górnej powierzchni tortu w jego lokalnych koordynatach
      currentLocalPos.y = THREE.MathUtils.clamp(
        currentLocalPos.y,
        cakeTopSurfaceY - maxPenetrationDepth, // Minimalna pozycja Y (obiekt "wchodzi" w tort)
        cakeTopSurfaceY + maxLiftOffDistance   // Maksymalna pozycja Y (obiekt unosi się nad tortem)
      );

    } else { // SIDE
      const currentObjectLocalRadius = Math.sqrt(currentLocalPos.x * currentLocalPos.x + currentLocalPos.z * currentLocalPos.z);

      // Ograniczenie radialne (odległość od osi Y tortu) - ZMODYFIKOWANE
      // cakeRadius to promień powierzchni bocznej tortu
      const clampedRadius = THREE.MathUtils.clamp(
        currentObjectLocalRadius,
        cakeRadius - maxPenetrationDepth, // Minimalny promień (obiekt "wchodzi" w bok tortu)
        cakeRadius + maxLiftOffDistance   // Maksymalny promień (obiekt odsuwa się od boku)
      );

      // Skaluj pozycję XZ tylko jeśli jest potrzeba i obiekt nie jest w centrum
      if (Math.abs(currentObjectLocalRadius - clampedRadius) > 0.001 && currentObjectLocalRadius > 0.001) {
        const radialScaleFactor = clampedRadius / currentObjectLocalRadius;
        // console.log('SIDE - Adjusting radius, scaling by:', radialScaleFactor.toFixed(2));
        currentLocalPos.x *= radialScaleFactor;
        currentLocalPos.z *= radialScaleFactor;
      }

      // Ograniczenie wysokości (Y) dla dekoracji bocznych - pozostaje bez zmian
      // Utrzymuje obiekt w granicach wysokości tortu
      const cakeMinY = -cakeHeight / 2;
      const cakeMaxY = cakeHeight / 2;
      currentLocalPos.y = THREE.MathUtils.clamp(
        currentLocalPos.y,
        // Aby pozwolić na "wjechanie" w górną/dolną krawędź, te limity musiałyby uwzględniać maxPenetrationDepth
        // Na razie trzymamy się powierzchni bocznej:
        cakeMinY + this.cakeSurfaceOffset, // Mały offset, by nie znikał na krawędziach
        cakeMaxY - this.cakeSurfaceOffset
      );

      // Aktualizacja rotacji, aby obiekt był zwrócony "na zewnątrz" od tortu
      const normal = new THREE.Vector3(currentLocalPos.x, 0, currentLocalPos.z).normalize();
      if (normal.lengthSq() === 0) { normal.set(1, 0, 0); } // Zabezpieczenie

      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, normal).normalize();
      const correctedUp = new THREE.Vector3().crossVectors(normal, right).normalize();
      const baseMatrix = new THREE.Matrix4().makeBasis(right, correctedUp, normal);
      const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(baseMatrix);

// 2. Odczytaj ZAPISANY offset rotacji z userData
//    Jeśli nie istnieje, użyj pustego kwaternionu (brak offsetu)
      const offsetQuaternion = this.selectedObject.userData['snapOffsetQuaternion'] || new THREE.Quaternion();

// 3. Połącz rotację bazową z offsetem i zastosuj
      this.selectedObject.quaternion.copy(baseQuaternion).multiply(offsetQuaternion);

    }

    // Zastosowanie skorygowanej pozycji lokalnej
    this.selectedObject.position.copy(currentLocalPos);

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

    const radius = cakeParams.radiusTop * this.cakeBase.scale.x; // Użyj skali X dla promienia
    const height = cakeParams.height * this.cakeBase.scale.y; // Użyj skali Y dla wysokości
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

