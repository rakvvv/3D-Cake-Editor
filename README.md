# 3D Cake Editor (CukierniaOnline)

## 1. WSTĘP

### 1.1 Wprowadzenie
Aplikacja **3D Cake Editor** to webowy edytor umożliwiający tworzenie i personalizację trójwymiarowych tortów. Interfejs użytkownika zbudowany jest w Angularze, a renderowanie 3D realizuje **Three.js**. Część serwerowa oparta jest o **Spring Boot**, z trwałym zapisem danych w **PostgreSQL** oraz z plikowym magazynem scen i miniaturek.

Docelowo narzędzie jest przeznaczone dla:
- cukierni i pracowni tortów (wizualizacja projektu dla klienta),
- projektantów UX/UI i grafików 3D (szybkie prototypowanie dekoracji),
- użytkowników indywidualnych planujących wygląd tortu.

### 1.2 Cel pracy/projektu
**Główny cel:** umożliwienie użytkownikowi projektowania tortu w 3D z możliwością personalizacji warstw, dekoracji i eksportu modeli.

**Cele szczegółowe:**
1. Zapewnienie intuicyjnego edytora 3D opartego o Three.js.
2. Umożliwienie dodawania dekoracji (modele 3D) i malowania powierzchni.
3. Utrzymanie stanu projektu w bazie danych (projekty użytkownika).
4. Obsługa presetów dekoracji i kotwic (anchor presets).
5. Eksport sceny do formatów OBJ/STL/GLTF oraz generowanie miniatur.

### 1.3 Problem badawczy i zakres pracy
**Problem:** projektowanie wyglądu tortu w 3D wymaga narzędzia, które łączy łatwość obsługi z realnym podglądem w przestrzeni oraz możliwością zapisania projektu.

**Zakres funkcjonalności:**
- edycja geometrii tortu (rozmiar, kształt, liczba warstw),
- tekstury, polewa, gradienty i wafer (opłatki),
- dekoracje 3D, kotwice (anchor presets), malowanie i ekstruder kremu,
- zapis projektów użytkownika, zarządzanie miniaturami,
- eksport modelu i zapis sceny.

**Ograniczenia projektu (z kodu):**
- konwersja modeli w backendzie jest obecnie placeholderem (zapisywane są pliki tekstowe z podsumowaniem danych sceny w `ModelConversionService`).
- brak osobnych endpointów do resetu hasła lub zarządzania profilami użytkowników.
- sceny 3D zapisywane są na dysku (`data/scenes`), niezależnie od bazy danych.

### 1.4 Hipotezy badawcze
1. **Użycie presetów** (gotowe torty i kotwice) skraca czas stworzenia projektu względem ręcznej konfiguracji.
2. **Renderowanie instancjonowanych obiektów** (np. pociągnięcia pędzlem, sprinkles) pozwala utrzymać płynność edytora w przeglądarce.
3. **Podgląd 3D z eksportem do STL/OBJ** zwiększa przydatność aplikacji w przygotowaniu projektów do dalszej obróbki.

---

## 2. CZĘŚĆ ZASADNICZA

### 2.1 Architektura aplikacji
Aplikacja ma architekturę **warstwową** z podziałem na:
- **Frontend (Angular + Three.js)**: renderowanie sceny 3D, UI edytora, zarządzanie stanem i interakcjami.
- **Backend (Spring Boot)**: API REST, autoryzacja JWT, zapisy projektów, presetów i miniatur.
- **Baza danych (PostgreSQL)**: użytkownicy, projekty, presety.
- **Magazyn plików**: zapis scen i miniatur (folder `data/scenes`).

**Przepływ danych (skrót):**
1. UI → serwisy Angular → API REST (Spring Boot)
2. API → zapis w DB (projekty/presety) i/lub zapis plików (sceny/miniatury)
3. API → odpowiedź JSON → UI (renderowanie i aktualizacja stanu)

**[PLACEHOLDER: Diagram architektury]**
![Architektura aplikacji](./docs/images/architecture-diagram.png)

**Opis diagramu architektury (co zawrzeć):**
- Warstwa **Frontend**: `CakeEditorComponent`, `ThreeSceneService`, `ProjectsService`, `AuthService`.
- Warstwa **Backend**: kontrolery REST (`/api/projects`, `/api/auth`, `/api/presets`, `/api/saveScene`).
- Warstwa **DB**: tabele `users`, `cake_projects`, `decorated_cake_presets`, `anchor_presets`.
- Warstwa **Storage**: `data/scenes` i miniatury.

### 2.2 Technologie i narzędzia
| Technologia | Wersja | Zastosowanie |
|-------------|--------|--------------|
| Angular | 19.2.x | Warstwa UI i SPA (`frontend/package.json`) |
| Three.js | 0.174.0 | Renderowanie 3D i eksport modeli (`frontend/package.json`) |
| RxJS | 7.8.x | Strumienie danych i stan aplikacji |
| TypeScript | 5.7.x | Język frontendowy |
| Vite | 6.2.x | Konfiguracja builda (Angular + Vite) |
| Spring Boot | 3.3.4 | Backend REST (`backend/pom.xml`) |
| Java | 17 | Runtime backendu |
| PostgreSQL | 16 (Docker) | Baza danych (`docker-compose.yml`) |
| Flyway | 10.17.0 | Migracje DB (`backend/pom.xml`) |
| JJWT | 0.11.5 | JWT autoryzacja |
| Docker + Compose | - | Uruchomienie całości stacku |

### 2.3 Struktura projektu
```
.
├── backend/                 # Spring Boot backend
│   ├── src/main/java/        # Kod źródłowy (kontrolery, serwisy, modele)
│   └── src/main/resources/   # application.yml, migracje Flyway, JSON-y danych
├── frontend/                # Angular + Three.js frontend
│   ├── src/                  # Komponenty, serwisy, modele
│   └── public/assets/        # Statyczne zasoby (modele, tekstury, presety)
├── docker/                  # Pliki pomocnicze dla Dockera
├── docs/                    # Dokumentacja i grafiki (placeholdery)
│   ├── images/              # Diagramy i zrzuty ekranu
│   └── diagrams/            # Źródła diagramów (np. draw.io, mermaid)
├── docker-compose.yml       # Stack: frontend + backend + db
└── README.md                # Dokumentacja główna
```

### 2.4 Baza danych
Model danych oparty jest o cztery tabele:
- **users**: dane kont użytkowników oraz role (USER/ADMIN).
- **cake_projects**: projekty użytkowników; relacja N:1 do `users` (pole `owner_id`).
- **decorated_cake_presets**: gotowe presety tortów.
- **anchor_presets**: presety kotwic dekoracji (anchor points).

Relacja kluczowa: `users (1) -> (N) cake_projects`.

**[PLACEHOLDER: Diagram ERD bazy danych]**
![Diagram ERD](./docs/images/erd-diagram.png)

**Co pokazać w ERD:**
- `users` (id, email, password_hash, role, created_at, updated_at)
- `cake_projects` (id, owner_id, name, data_json, thumbnail_url, created_at, updated_at)
- `decorated_cake_presets` (id, preset_id, name, data_json, thumbnail_url, description, cake_shape, cake_size, tiers)
- `anchor_presets` (id, preset_id, name, data_json, cake_shape, cake_size, tiers)
- Relacja FK: `cake_projects.owner_id -> users.id`

**[PLACEHOLDER: Diagram UML klas]**
![Diagram UML](./docs/images/uml-class-diagram.png)

**Co pokazać w UML:**
- Klasy encji backendu: `User`, `CakeProject`, `DecoratedCakePreset`, `AnchorPresetEntity`.
- DTO: `AuthRequest`, `AuthResponse`, `CakeProjectSummaryDto`, `CakeProjectDetailDto`, `SaveCakeProjectRequest`, `StoredPresetDto`.
- Serwisy kluczowe: `ThreeSceneService` (frontend), `SceneStorageService` (backend).

### 2.5 Opis modułów/komponentów
Poniżej zestawienie głównych modułów i komponentów (frontend i backend).

#### Frontend – komponenty UI

**AppComponent** (`frontend/src/app/app.component.ts`)
- **Odpowiedzialność:** root aplikacji, hostowanie routera.
- **Wejścia:** brak.
- **Wyjścia/efekty:** inicjalizacja SPA.
- **Zależności:** `RouterOutlet`, `HttpClientModule`.

**CakeEditorComponent** (`frontend/src/app/cake-editor/cake-editor.component.ts`)
- **Odpowiedzialność:** główny edytor 3D (tryb setup/workspace), zarządzanie sceną, kamerą i stanem projektu.
- **Wejścia:** parametry routingu (`projectId`).
- **Wyjścia/efekty:** inicjalizacja Three.js, zapis projektu, eksport modeli, obsługa paneli bocznych.
- **Zależności:** `ThreeSceneService`, `ProjectsService`, `PaintService`, `TexturesService`, `AnchorPresetsService`, `SurfacePaintingService`.

**EditorSidebarComponent** (`frontend/src/app/cake-editor/sidebar/editor-sidebar.component.ts`)
- **Odpowiedzialność:** panel boczny edytora (dekoracje, malowanie, presety, admin).
- **Wejścia:** `@Input` (m.in. `options`, `paintingMode`, `paintColor`, `isAdmin`).
- **Wyjścia:** `@Output` (zmiany opcji, dodanie dekoracji, zapis sceny, eksport).
- **Zależności:** `CakePresetsService`, `ThreeSceneService`.

**SidebarDecorationsPanelComponent** (`frontend/src/app/cake-editor/sidebar/panels/sidebar-decorations-panel.component.ts`)
- **Odpowiedzialność:** wybór dekoracji, filtrowanie, presety kotwic, dodawanie dekoracji.
- **Wejścia:** `layerCount`.
- **Wyjścia:** `addDecoration` (emit `AddDecorationRequest`).
- **Zależności:** `DecorationsService`, `AnchorPresetsService`, `PaintService`.

**SidebarPaintPanelComponent** (`frontend/src/app/cake-editor/sidebar/panels/sidebar-paint-panel.component.ts`)
- **Odpowiedzialność:** tryby malowania (pędzel, sprinkles, ekstruder), konfiguracja parametrów.
- **Wejścia:** `mode`, `paintColor`, `penSize`, `penThickness`, `penOpacity`, `brushId`.
- **Wyjścia:** `paintModeChange`, `brushChange`, `paintingPowerChange`.
- **Zależności:** `PaintService`, `SurfacePaintingService`.

**SidebarPresetsPanelComponent** (`frontend/src/app/cake-editor/sidebar/panels/sidebar-presets-panel.component.ts`)
- **Odpowiedzialność:** lista gotowych tortów (presets).
- **Wejścia:** `presets`.
- **Wyjścia:** `applyCakePreset`.
- **Zależności:** brak bezpośrednich serwisów.

**SidebarAdminPanelComponent** (`frontend/src/app/cake-editor/sidebar/panels/sidebar-admin-panel.component.ts`)
- **Odpowiedzialność:** panel administracyjny do zapisu presetów tortów i kotwic.
- **Wejścia:** `cakeShape`, `cakeSize`, `tiers`.
- **Wyjścia:** zapis do API `/api/admin/presets/**`.
- **Zależności:** `AdminPresetService`, `AnchorPresetsService`, `CakePresetsService`.

**SidebarExportPanelComponent** (`frontend/src/app/cake-editor/sidebar/panels/sidebar-export-panel.component.ts`)
- **Odpowiedzialność:** panel eksportu i walidacji dekoracji.
- **Wejścia:** `validationSummary`, `validationIssues`, `pendingValidationLabel`.
- **Wyjścia:** zdarzenia eksportu (OBJ/STL/GLTF) i zrzutu ekranu.
- **Zależności:** brak bezpośrednich serwisów.

**ProjectListComponent** (`frontend/src/app/project-list/project-list.component.ts`)
- **Odpowiedzialność:** lista projektów, tworzenie/zmiana nazwy/usuwanie, przejście do edytora.
- **Wejścia:** brak.
- **Wyjścia/efekty:** wywołania `ProjectsService`.
- **Zależności:** `ProjectsService`, `AuthService`, `Router`.

**LoginComponent** (`frontend/src/app/cake-editor/auth/login.component.ts`)
- **Odpowiedzialność:** logowanie użytkownika.
- **Wejścia:** email/hasło (formularz).
- **Wyjścia:** zapis tokenu i przekierowanie.
- **Zależności:** `AuthService`.

**RegisterComponent** (`frontend/src/app/cake-editor/auth/register.component.ts`)
- **Odpowiedzialność:** rejestracja użytkownika.
- **Wejścia:** email/hasło (formularz).
- **Wyjścia:** rejestracja i przekierowanie.
- **Zależności:** `AuthService`.

#### Frontend – serwisy i factory

**ThreeSceneService** (`frontend/src/app/services/three-scene.service.ts`)
- **Odpowiedzialność:** pełne zarządzanie sceną Three.js (tworzenie tortu, dekoracje, kamera, eksport, walidacje).
- **Wejścia:** `CakeOptions`, parametry interakcji użytkownika.
- **Wyjścia/efekty:** modyfikacja sceny 3D, generowanie presetów, eksporty.
- **Zależności:** `SceneInitService`, `DecorationsService`, `PaintService`, `SurfacePaintingService`, `ExportService`, `SnapService`.

**SceneInitService** (`frontend/src/app/services/scene-init.service.ts`)
- **Odpowiedzialność:** inicjalizacja sceny, kamery, orbit controls i oświetlenia.
- **Wejścia:** kontener HTML.
- **Wyjścia:** skonfigurowana scena Three.js.
- **Zależności:** `three`, `OrbitControls`.

**DecorationsService** (`frontend/src/app/services/decorations.service.ts`)
- **Odpowiedzialność:** zarządzanie metadanymi dekoracji i dodawaniem modeli do sceny.
- **Wejścia:** identyfikator dekoracji, preferowana powierzchnia.
- **Wyjścia/efekty:** obiekty 3D w scenie + snap do tortu.
- **Zależności:** `DecorationFactory`, `TransformControlsService`, `SnapService`.

**PaintService** (`frontend/src/app/services/paint.service.ts`)
- **Odpowiedzialność:** tryb malowania 3D (pędzel, dekoracje, ekstruder) oraz instancjonowanie stroke'ów.
- **Wejścia:** parametry pędzla, zdarzenia myszy.
- **Wyjścia/efekty:** obiekty malowania w scenie, zapis w presetach.
- **Zależności:** `DecorationsService`, `SnapService`, `TransformManagerService`.

**SurfacePaintingService** (`frontend/src/app/services/surface-painting.service.ts`)
- **Odpowiedzialność:** malowanie powierzchni tortu (pędzel 2D, sprinkles, gradienty).
- **Wejścia:** tryb malowania, parametry pędzla/sprinkles.
- **Wyjścia/efekty:** shaderowe tekstury i instancje na torcie.
- **Zależności:** `GradientTextureService`, `PaintService`.

**AnchorPresetsService** (`frontend/src/app/services/anchor-presets.service.ts`)
- **Odpowiedzialność:** wczytywanie presetów kotwic i zarządzanie markerami na scenie.
- **Wejścia:** dane presetów (API lub lokalny fallback).
- **Wyjścia/efekty:** widoczne markery/anchor points.
- **Zależności:** `SnapService`, `HttpClient`.

**CakePresetsService** (`frontend/src/app/services/cake-presets.service.ts`)
- **Odpowiedzialność:** wczytywanie gotowych tortów (API lub lokalny fallback).
- **Wejścia:** URL presetów.
- **Wyjścia:** `BehaviorSubject` z listą presetów.
- **Zależności:** `HttpClient`.

**ExportService** (`frontend/src/app/services/export.service.ts`)
- **Odpowiedzialność:** eksport sceny do OBJ/STL/GLTF + screenshot.
- **Wejścia:** scena Three.js.
- **Wyjścia:** generowane pliki po stronie klienta.
- **Zależności:** Three.js exporters.

**TexturesService** (`frontend/src/app/services/textures.service.ts`)
- **Odpowiedzialność:** wczytywanie zestawów tekstur (`/api/textures`).
- **Wejścia:** brak (API).
- **Wyjścia:** `BehaviorSubject` z zestawami tekstur.
- **Zależności:** `HttpClient`.

**ProjectsService** (`frontend/src/app/services/projects.service.ts`)
- **Odpowiedzialność:** CRUD projektów użytkownika.
- **Wejścia:** dane projektów (JSON z presetem).
- **Wyjścia:** obiekty DTO z API.
- **Zależności:** `HttpClient`.

**AuthService** (`frontend/src/app/services/auth.service.ts`)
- **Odpowiedzialność:** logowanie, rejestracja i token JWT w localStorage.
- **Wejścia:** email i hasło.
- **Wyjścia:** stan użytkownika (`BehaviorSubject`).
- **Zależności:** `HttpClient`.

**AdminPresetService** (`frontend/src/app/services/admin-preset.service.ts`)
- **Odpowiedzialność:** zapis presetów i miniaturek przez admina.
- **Wejścia:** payload presetów.
- **Wyjścia:** API `/api/admin/presets/**`.
- **Zależności:** `HttpClient`.

**AuthGuard / AdminGuard** (`frontend/src/app/services/auth.guard.ts`, `admin.guard.ts`)
- **Odpowiedzialność:** ochrona tras wymagających autoryzacji.
- **Wejścia:** stan zalogowania.
- **Wyjścia:** przekierowania.
- **Zależności:** `AuthService`, `Router`.

**AuthInterceptor** (`frontend/src/app/services/auth.interceptor.ts`)
- **Odpowiedzialność:** automatyczne dołączanie JWT do requestów API.
- **Wejścia:** request HTTP.
- **Wyjścia:** request z nagłówkiem `Authorization`.
- **Zależności:** `AuthService`.

**SelectionService** (`frontend/src/app/services/selection.service.ts`)
- **Odpowiedzialność:** zaznaczanie obiektów i obsługa transformacji.
- **Wejścia:** obiekt 3D.
- **Wyjścia:** aktywna selekcja.
- **Zależności:** `TransformControls`.

**TransformControlsService / TransformManagerService** (`frontend/src/app/services/transform-controls-service.ts`, `transform-manager.service.ts`)
- **Odpowiedzialność:** kontrola transformacji obiektów w scenie (translate/rotate/scale).
- **Wejścia:** obiekty 3D, tryb transformacji.
- **Wyjścia:** modyfikacje obiektów i stanu sceny.
- **Zależności:** `SnapService`, `SelectionService`.

**SnapService** (`frontend/src/app/services/snap.service.ts`)
- **Odpowiedzialność:** przyciąganie dekoracji do powierzchni tortu i anchorów.
- **Wejścia:** obiekt 3D + preferowana powierzchnia.
- **Wyjścia:** pozycja/orientacja dekoracji.
- **Zależności:** `SnapState`.

**GradientTextureService** (`frontend/src/app/services/gradient-texture.service.ts`)
- **Odpowiedzialność:** generowanie gradientowych tekstur dla tortu.
- **Wejścia:** parametry gradientu.
- **Wyjścia:** `THREE.CanvasTexture`.
- **Zależności:** Canvas API.

**PresetDialogService** (`frontend/src/app/services/preset-dialog.service.ts`)
- **Odpowiedzialność:** prosty modal do podglądu danych presetów.
- **Wejścia:** tytuł i payload.
- **Wyjścia:** `BehaviorSubject` z treścią dialogu.
- **Zależności:** brak.

**Factory**: `DecorationFactory`, `ThreeObjectsFactory`, `TextFactory` (`frontend/src/app/factories/*`)
- **Odpowiedzialność:** generowanie obiektów 3D (geometria, tekst, dekoracje).
- **Wejścia:** parametry obiektu i zasoby.
- **Wyjścia:** obiekty Three.js.
- **Zależności:** `three`.

#### Backend – kontrolery API

**AuthController** (`backend/src/main/java/com/cake/editor/controller/AuthController.java`)
- **Odpowiedzialność:** logowanie, rejestracja, endpoint `/api/auth/me`.
- **Wejścia:** `AuthRequest`.
- **Wyjścia:** `AuthResponse` (token + user).
- **Zależności:** `JwtService`, `UserRepository`, `PasswordEncoder`.

**CakeProjectController** (`backend/src/main/java/com/cake/editor/controller/CakeProjectController.java`)
- **Odpowiedzialność:** CRUD projektów użytkownika.
- **Wejścia:** `SaveCakeProjectRequest`.
- **Wyjścia:** DTO listy i szczegółów projektu.
- **Zależności:** `CakeProjectRepository`, `CurrentUserService`.

**ThumbnailController** (`backend/src/main/java/com/cake/editor/controller/ThumbnailController.java`)
- **Odpowiedzialność:** upload i pobieranie miniaturek projektów.
- **Wejścia:** `MultipartFile`.
- **Wyjścia:** `thumbnailUrl`.
- **Zależności:** `ThumbnailService`.

**PresetController** (`backend/src/main/java/com/cake/editor/controller/PresetController.java`)
- **Odpowiedzialność:** pobieranie presetów (gotowe torty i kotwice).
- **Wejścia:** brak.
- **Wyjścia:** `StoredPresetDto` listy.
- **Zależności:** repozytoria presetów, `ThumbnailService`.

**AdminPresetController** (`backend/src/main/java/com/cake/editor/controller/AdminPresetController.java`)
- **Odpowiedzialność:** zapisy presetów i miniaturek (ADMIN).
- **Wejścia:** `CreateDecoratedCakePresetRequest`, `CreateAnchorPresetRequest`.
- **Wyjścia:** `StoredPresetDto`.
- **Zależności:** repozytoria presetów, `ThumbnailService`.

**DecorationsController** (`backend/src/main/java/com/cake/editor/controller/DecorationsController.java`)
- **Odpowiedzialność:** udostępnienie listy dekoracji z `decorations.json`.
- **Wejścia:** brak.
- **Wyjścia:** `DecorationMetadata[]`.
- **Zależności:** `ObjectMapper`.

**ExtruderVariantsController** (`backend/src/main/java/com/cake/editor/controller/ExtruderVariantsController.java`)
- **Odpowiedzialność:** warianty ekstrudera z `extruder-variants.json`.
- **Wejścia:** brak.
- **Wyjścia:** `ExtruderVariantMetadata[]`.
- **Zależności:** `ObjectMapper`.

**TexturesController** (`backend/src/main/java/com/cake/editor/controller/TexturesController.java`)
- **Odpowiedzialność:** indeks tekstur z `textures.json`.
- **Wejścia:** brak.
- **Wyjścia:** `TextureIndex`.
- **Zależności:** `ObjectMapper`.

**SceneController** (`backend/src/main/java/com/cake/editor/controller/SceneController.java`)
- **Odpowiedzialność:** zapis i odczyt scen 3D (`/api/saveScene`, `/api/scene/{id}`).
- **Wejścia:** `SceneSaveRequest`.
- **Wyjścia:** `SceneResponse`.
- **Zależności:** `SceneStorageService`.

#### Backend – serwisy

**SceneStorageService** (`backend/src/main/java/com/cake/editor/service/SceneStorageService.java`)
- **Odpowiedzialność:** zapis sceny na dysku + inicjalna konwersja modeli.
- **Wejścia:** `SceneSaveRequest`.
- **Wyjścia:** `StoredScene`.
- **Zależności:** `ModelConversionService`, `ApplicationProperties`.

**ModelConversionService** (`backend/src/main/java/com/cake/editor/service/ModelConversionService.java`)
- **Odpowiedzialność:** generowanie placeholderów plików konwersji (`scene-*.txt`).
- **Wejścia:** dane sceny, formaty docelowe.
- **Wyjścia:** mapa ścieżek do plików.
- **Zależności:** `ApplicationProperties`.

**ThumbnailService** (`backend/src/main/java/com/cake/editor/service/ThumbnailService.java`)
- **Odpowiedzialność:** zapis i odczyt miniaturek (projekty i presety).
- **Wejścia:** `MultipartFile`.
- **Wyjścia:** `Resource` z plikiem PNG.
- **Zależności:** `ApplicationProperties`.

**CurrentUserService** (`backend/src/main/java/com/cake/editor/service/CurrentUserService.java`)
- **Odpowiedzialność:** pobranie aktualnego użytkownika z kontekstu Spring Security.
- **Wejścia:** kontekst bezpieczeństwa.
- **Wyjścia:** `User`.
- **Zależności:** `UserRepository`.

#### Backend – repozytoria i modele
Repozytoria (`backend/src/main/java/com/cake/editor/repository/*`) obsługują encje:
- `User`, `CakeProject`, `DecoratedCakePreset`, `AnchorPresetEntity`.

Encje (`backend/src/main/java/com/cake/editor/model/*`):
- **User** – dane użytkownika i rola.
- **CakeProject** – projekt użytkownika z JSON-em sceny.
- **DecoratedCakePreset** – preset gotowego tortu.
- **AnchorPresetEntity** – preset kotwic.
- **StoredScene** – zapis plikowy sceny 3D.

**[PLACEHOLDER: Diagram komponentów]**
![Diagram komponentów](./docs/images/components-diagram.png)

**Co powinien zawierać diagram komponentów:**
- Frontend: `CakeEditorComponent` ↔ `EditorSidebarComponent` ↔ `Sidebar*Panel`.
- Serwisy 3D: `ThreeSceneService` ↔ `PaintService` ↔ `SurfacePaintingService` ↔ `SnapService`.
- Backend API: `SceneController`, `CakeProjectController`, `PresetController`.

### 2.6 Funkcjonalności aplikacji

#### 2.6.1 Edycja 3D tortu
- Renderowanie 3D realizowane przez **Three.js** w `ThreeSceneService`.
- Interakcja: OrbitControls, transformacje obiektów (translate/rotate/scale).
- Dostępne narzędzia: dekoracje 3D, malowanie (pędzel/sprinkles/ekstruder), snap do powierzchni.

**[PLACEHOLDER: Screenshot edytora 3D]**
![Edytor 3D](./docs/images/screenshot-editor.png)

#### 2.6.2 Konfiguracja warstw/elementów
- Zmiana liczby warstw, kształtu (cylinder/cuboid), kolorystyki i polewy.
- Personalizacja: gradienty, tekstury, opłatek (wafer) z parametrami skali i offsetu.

**[PLACEHOLDER: Screenshot konfiguracji]**
![Konfiguracja](./docs/images/screenshot-config.png)

#### 2.6.3 Eksport/Zapis
- Eksport modeli do **OBJ**, **STL** i **GLTF/GLB** (`ExportService`).
- Zapis sceny w backendzie (`/api/saveScene`) z plikową archiwizacją.
- Generowanie zrzutów ekranu i miniaturek projektu.

#### 2.6.4 Inne funkcjonalności znalezione w kodzie
- System użytkowników (rejestracja/logowanie) z JWT.
- Presety gotowych tortów i kotwic, z fallbackiem do lokalnych JSON-ów.
- Panel administracyjny do zapisu nowych presetów.
- Lista projektów z wyszukiwaniem, zmianą nazwy i usuwaniem.

### 2.7 API i endpointy (jeśli istnieją)
| Metoda | Endpoint | Opis | Parametry | Odpowiedź |
|--------|----------|------|-----------|-----------|
| POST | `/api/auth/register` | Rejestracja | `{email, password}` | `AuthResponse` |
| POST | `/api/auth/login` | Logowanie | `{email, password}` | `AuthResponse` |
| GET | `/api/auth/me` | Aktualny użytkownik | nagł. `Authorization` | `UserDto` |
| GET | `/api/projects` | Lista projektów | - | `CakeProjectSummaryDto[]` |
| POST | `/api/projects` | Utworzenie projektu | `SaveCakeProjectRequest` | `CakeProjectDetailDto` |
| GET | `/api/projects/{id}` | Szczegóły projektu | - | `CakeProjectDetailDto` |
| PUT | `/api/projects/{id}` | Aktualizacja projektu | `SaveCakeProjectRequest` | `CakeProjectDetailDto` |
| DELETE | `/api/projects/{id}` | Usunięcie projektu | - | `204 No Content` |
| POST | `/api/projects/{id}/thumbnail` | Upload miniatury | `multipart/form-data` | `{thumbnailUrl}` |
| GET | `/api/projects/{id}/thumbnail` | Pobranie miniatury | - | PNG |
| GET | `/api/presets/cakes` | Presety tortów | - | `StoredPresetDto[]` |
| GET | `/api/presets/anchors` | Presety kotwic | - | `StoredPresetDto[]` |
| GET | `/api/presets/cakes/{presetId}/thumbnail` | Miniatura presetu | - | PNG |
| POST | `/api/admin/presets/cakes` | Zapis presetu tortu (ADMIN) | `CreateDecoratedCakePresetRequest` | `StoredPresetDto` |
| POST | `/api/admin/presets/anchors` | Zapis presetu kotwic (ADMIN) | `CreateAnchorPresetRequest` | `StoredPresetDto` |
| PUT | `/api/admin/presets/anchors/{presetId}` | Aktualizacja presetu kotwic (ADMIN) | `CreateAnchorPresetRequest` | `StoredPresetDto` |
| DELETE | `/api/admin/presets/anchors/{presetId}` | Usunięcie presetu (ADMIN) | - | `204 No Content` |
| POST | `/api/admin/presets/cakes/{presetId}/thumbnail` | Upload miniatury presetu (ADMIN) | `multipart/form-data` | `{thumbnailUrl}` |
| GET | `/api/decorations` | Lista dekoracji | - | `DecorationMetadata[]` |
| GET | `/api/extruder-variants` | Warianty ekstrudera | - | `ExtruderVariantMetadata[]` |
| GET | `/api/textures` | Zestawy tekstur | - | `TextureIndex` |
| POST | `/api/saveScene` | Zapis sceny 3D | `SceneSaveRequest` | `SceneResponse` |
| GET | `/api/scene/{id}` | Pobranie sceny 3D | - | `SceneResponse` |

### 2.8 Instrukcja instalacji i uruchomienia

**Docker (najprościej):**
```bash
cp .env.example .env
docker compose up --build
```
Po starcie aplikacja dostępna jest pod `http://localhost:8080`.

**Uruchomienie lokalne (dev):**
```bash
# Backend
mvn -f backend/pom.xml spring-boot:run

# Frontend
cd frontend
npm install
npm start
```
Frontend domyślnie działa pod `http://localhost:4200`.

### 2.9 Przewodnik użytkownika (User Guide)
1. **Uruchom aplikację** (Docker lub lokalnie).
2. **Zaloguj się** lub zarejestruj (`/login`, `/register`).
3. **Utwórz nowy projekt** na liście projektów.
4. **Skonfiguruj tort**: kształt, rozmiar, liczba warstw, kolor, polewa, tekstury.
5. **Dodaj dekoracje 3D** z panelu bocznego.
6. **Maluj powierzchnię** (pędzel/sprinkles/ekstruder).
7. **Podgląd 3D** – użyj kamery i narzędzi transformacji.
8. **Eksportuj model** (OBJ/STL/GLTF) lub zrób zrzut ekranu.
9. **Zapisz projekt** – projekt pojawi się na liście głównej.

**[PLACEHOLDER: GIF z demo użycia]**
![Demo](./docs/images/demo.gif)

### 2.10 Testy
- **Frontend (Karma + Jasmine):** `npm test`
- **Backend (Maven):** `mvn -f backend/pom.xml test`

W repozytorium brak dedykowanych testów e2e; można uruchomić `ng e2e` po skonfigurowaniu frameworka e2e.

---

## 3. ZAKOŃCZENIE I WNIOSKI KOŃCOWE

### 3.1 Podsumowanie zrealizowanych celów
- Edytor 3D działa w oparciu o Three.js i Angular.
- Projekty użytkowników są przechowywane w PostgreSQL.
- Dostępne są presety, dekoracje i malowanie powierzchni.
- Eksport modeli i zapis sceny są dostępne.

**Weryfikacja hipotez:**
- Presety i anchor presets faktycznie przyspieszają pracę (obserwacja wynikająca z implementacji workflow).
- Malowanie i instancjonowanie obiektów jest zoptymalizowane pod wydajność (implementacja InstancedMesh).
- Eksport do standardowych formatów zwiększa wartość narzędzia.

### 3.2 Napotkane problemy i ich rozwiązania
- **Wydajność sceny 3D:** zastosowanie `InstancedMesh` dla pociągnięć pędzla i sprinkles.
- **Separacja danych presetów:** fallback do lokalnych JSON-ów w przypadku braku API.
- **Konwersja modeli:** zastosowano placeholdery (do dalszej rozbudowy).

### 3.3 Możliwości rozwoju (TODO/Roadmap)
- Wdrożenie realnej konwersji modeli do STL/OBJ w backendzie.
- Dodanie wersjonowania projektów i historii zmian.
- Rozszerzenie panelu admina o zarządzanie zasobami dekoracji.

### 3.4 Wnioski końcowe
Projekt łączy technologie frontendowe (Angular + Three.js) z backendem (Spring Boot + PostgreSQL), tworząc kompletną aplikację do projektowania tortów 3D. Rozwiązanie może być bazą dla dalszego rozwoju komercyjnego narzędzia.

---

## 4. BIBLIOGRAFIA I ŹRÓDŁA
Format:
```
[1] Autor, "Tytuł", Źródło, Data dostępu: DD.MM.YYYY
```

Przykładowe źródła (do uzupełnienia datą dostępu):
- [1] Dokumentacja Angular, "Angular Docs", https://angular.dev, Data dostępu: DD.MM.YYYY
- [2] Dokumentacja Three.js, "Three.js Docs", https://threejs.org/docs, Data dostępu: DD.MM.YYYY
- [3] Dokumentacja Spring Boot, "Spring Boot Reference", https://spring.io/projects/spring-boot, Data dostępu: DD.MM.YYYY
- [4] Dokumentacja PostgreSQL, "PostgreSQL Docs", https://www.postgresql.org/docs, Data dostępu: DD.MM.YYYY
- [5] Dokumentacja Flyway, "Flyway Docs", https://flywaydb.org/documentation, Data dostępu: DD.MM.YYYY
- [6] Dokumentacja JJWT, "JJWT Docs", https://github.com/jwtk/jjwt, Data dostępu: DD.MM.YYYY

---

## 5. ZAŁĄCZNIKI

### 5.1 Spis ilustracji
| Nr | Tytuł | Lokalizacja |
|----|-------|------------|
| 1 | Diagram architektury | `./docs/images/architecture-diagram.png` |
| 2 | Diagram ERD | `./docs/images/erd-diagram.png` |
| 3 | Diagram UML | `./docs/images/uml-class-diagram.png` |
| 4 | Diagram komponentów | `./docs/images/components-diagram.png` |
| 5 | Screenshot edytora 3D | `./docs/images/screenshot-editor.png` |
| 6 | Screenshot konfiguracji | `./docs/images/screenshot-config.png` |
| 7 | Demo (GIF) | `./docs/images/demo.gif` |

### 5.2 Spis tabel
| Nr | Tytuł | Lokalizacja |
|----|-------|------------|
| 1 | Technologie i narzędzia | Sekcja 2.2 |
| 2 | API i endpointy | Sekcja 2.7 |

### 5.3 Słownik pojęć (Glossary)
| Termin | Definicja |
|--------|----------|
| Anchor preset | Zestaw punktów (kotwic) określających dopuszczalne miejsca dekoracji na torcie. |
| Preset tortu | Zapisana konfiguracja tortu wraz z dekoracjami i ustawieniami. |
| InstancedMesh | Optymalizacja Three.js pozwalająca renderować wiele instancji jednego obiektu. |
| Snap | Mechanizm przyciągania dekoracji do powierzchni tortu. |
| Wafer | Opłatek nanoszony na górną powierzchnię tortu. |
