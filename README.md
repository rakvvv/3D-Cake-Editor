# CukierniaOnline

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.2.1.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Backend database

The backend now targets PostgreSQL. A disposable instance is available via Docker:

```bash
docker compose up -d db
```

The default credentials are `cake_editor` / `devpass` on `localhost:5432`. Override them with standard Spring `SPRING_DATASOURCE_*` environment variables when starting the backend.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## Manual validation: tryb pisaka

1. Uruchom aplikację lokalnie poleceniem `ng serve` i otwórz edytor tortu w przeglądarce.
2. W panelu malowania wybierz tryb **Pisak**, ustaw kolor oraz rozmiar i grubość znacznika.
3. Włącz miernik FPS w narzędziach deweloperskich przeglądarki (np. `Rendering > FPS meter` w Chrome) i upewnij się, że wartość utrzymuje się stabilnie podczas rysowania.
4. Przytrzymaj lewy przycisk myszy na powierzchni tortu i płynnie poruszaj kursorem – kamera powinna pozostać nieruchoma, a linia pojawiać się bez zauważalnych spadków płynności nawet przy dużej grubości pisaka.
5. Zwiększ maksymalnie grubość pisaka i poprowadź długą linię bez odrywania – krawędzie powinny pozostać gładkie i stabilne, bez deformacji lub ostrych załamań w trakcie rysowania.
6. Zatrzymaj rysowanie i zmień jedynie rozmiar końcówki: nowe pociągnięcia powinny mieć tę samą grubość linii, ale pełniejsze, bardziej zaokrąglone końcówki.
7. Puść przycisk i wciśnij ponownie w innym miejscu, aby upewnić się, że nowe fragmenty łączą się bez widocznych przerw.
8. W trybie dekoracji dodaj kilka ozdób 3D, obserwując brak dużych przycięć przy wstawianiu modeli, a następnie użyj skrótów `Ctrl+Z` oraz `Ctrl+Shift+Z`/`Ctrl+Y`, żeby sprawdzić działanie cofania i przywracania zmian (opcjonalnie skorzystaj z przycisków w panelu).
9. Zweryfikuj, że obrót kamery prawym przyciskiem myszy nie wywołuje menu kontekstowego na płótnie.

## Manual regression plan: polewa

1. Uruchom `ng serve` i otwórz edytor pod `http://localhost:4200/`.
2. W panelu „Opcje tortu” włącz i wyłącz polewę – upewnij się, że połyskliwy materiał znika/pojawia się na górnym piętrze oraz reaguje na zmianę koloru.
3. Ustaw minimalną grubość i długość zacieków, a następnie maksymalną – obserwuj, czy wysokość kopuły oraz zasięg zacieków odpowiadają wartościom suwaków.
4. Przy maksymalnych zaciekach wykonaj zrzut ekranu tortu (z widoku izometrycznego), który posłuży jako referencja wizualna przy kolejnych wydaniach.
