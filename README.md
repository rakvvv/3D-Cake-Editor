# CukierniaOnline

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.2.1.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

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
4. Przytrzymaj lewy przycisk myszy na powierzchni tortu i płynnie poruszaj kursorem – kamera powinna pozostać nieruchoma, a linia pojawiać się bez zauważalnych spadków płynności.
5. Zwolnij przycisk myszy; rysowanie powinno się zatrzymać natychmiast, a ponowne kliknięcie rozpocznie nowy odcinek bez nagromadzenia duplikatów.
