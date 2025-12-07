import {Component, AfterViewInit, ViewChild, ElementRef, Inject, PLATFORM_ID, OnDestroy, OnInit} from '@angular/core';
import {CommonModule, isPlatformBrowser} from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {CakeSidebarComponent} from '../cake-sidebar/cake-sidebar.component';
import {ThreeSceneService} from '../services/three-scene.service';
import {DecorationsService} from '../services/decorations.service';
import {PaintService} from '../services/paint.service';
import {TransformControlsService} from '../services/transform-controls-service';
import {CakeOptions} from '../models/cake.options';
import {DecorationValidationIssue} from '../models/decoration-validation';
import {AddDecorationRequest} from '../models/add-decoration-request';
import {AnchorPresetsService} from '../services/anchor-presets.service';
import {Subscription} from 'rxjs';
import { environment } from '../../environments/environment';
import { PresetExportDialogComponent } from '../preset-export-dialog/preset-export-dialog.component';
import { DecoratedCakePreset } from '../models/cake-preset';
import { ProjectsService } from '../services/projects.service';
import { AuthService } from '../services/auth.service';
import { DEFAULT_CAKE_OPTIONS, cloneCakeOptions } from '../models/default-cake-options';

@Component({
  selector: 'app-cake-editor',
  standalone: true,
  imports: [CommonModule, CakeSidebarComponent, PresetExportDialogComponent],
  templateUrl: './cake-editor.component.html',
  styleUrls: ['./cake-editor.component.css']
})
export class CakeEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  private container?: ElementRef;
  @ViewChild('canvasContainer') set canvasContainer(element: ElementRef | undefined) {
    this.container = element;
    this.maybeInitializeScene();
  }

  readonly authorModeEnabled = environment.authorMode;

  public options: CakeOptions = cloneCakeOptions(DEFAULT_CAKE_OPTIONS);

  public projectName = '';
  public loadingProject = true;
  public loadError: string | null = null;
  private currentProjectId: number | null = null;
  private pendingPreset: DecoratedCakePreset | null = null;
  private sceneInitialized = false;
  private viewReady = false;

  public validationSummary: string | null = null;
  public validationIssues: DecorationValidationIssue[] = [];
  public pendingValidationLabel: string | null = null;
  public statusMessage: string | null = null;

  public contextMenuVisible = false;
  public contextMenuX = 0;
  public contextMenuY = 0;
  public contextMenuHasSelection = false;
  public contextMenuCanSnap = false;
  public contextMenuIsLocked = false;

  private pendingValidationAction: (() => void) | null = null;
  private statusTimeoutId: number | null = null;
  private anchorClickSubscription?: Subscription;

  private readonly handleDocumentClick = () => this.hideContextMenu();
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.hideContextMenu();
      return;
    }

    if (this.shouldHandleResetShortcut(event)) {
      event.preventDefault();
      this.resetCameraView();
    }
  };

  private contextMenuListener = (event: MouseEvent) => this.onContextMenu(event);

  constructor(
    public sceneService: ThreeSceneService,
    private transformService: TransformControlsService,
    private decorationsService: DecorationsService,
    private paintService: PaintService,
    private anchorPresetsService: AnchorPresetsService,
    private projectsService: ProjectsService,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('projectId');
    this.currentProjectId = idParam ? Number(idParam) : null;
    if (this.currentProjectId) {
      this.loadProject(this.currentProjectId);
    } else {
      this.loadingProject = false;
      this.loadError = 'Nie znaleziono projektu.';
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.maybeInitializeScene();
    if (isPlatformBrowser(this.platformId)) {
      this.anchorClickSubscription = this.anchorPresetsService.anchorClicks$.subscribe((anchorId) => {
        void this.handleAnchorClick(anchorId);
      });
      const containerEl = this.container?.nativeElement as HTMLElement | undefined;
      containerEl?.addEventListener('contextmenu', this.contextMenuListener);
      document.addEventListener('click', this.handleDocumentClick);
      document.addEventListener('keydown', this.handleKeyDown);
    }
  }

  private loadProject(projectId: number): void {
    this.loadingProject = true;
    this.projectsService.getProject(projectId).subscribe({
      next: (detail) => {
        this.projectName = detail.name;
        const preset = this.parseProjectPreset(detail.dataJson, detail.name);
        this.pendingPreset = preset;
        this.options = cloneCakeOptions(preset.options);
        this.loadingProject = false;
        this.maybeInitializeScene();
      },
      error: () => {
        this.loadingProject = false;
        this.loadError = 'Nie udało się wczytać projektu.';
      },
    });
  }

  private parseProjectPreset(dataJson: string, fallbackName: string): DecoratedCakePreset {
    try {
      const preset = JSON.parse(dataJson) as DecoratedCakePreset;
      if (!preset.options) {
        throw new Error('Missing options');
      }
      return {
        ...preset,
        name: preset.name || fallbackName,
      };
    } catch (error) {
      return {
        id: `project-${Date.now()}`,
        name: fallbackName,
        options: cloneCakeOptions(DEFAULT_CAKE_OPTIONS),
        decorations: [],
      };
    }
  }

  private maybeInitializeScene(): void {
    if (this.sceneInitialized || !this.viewReady || !this.pendingPreset) {
      return;
    }

    this.initializeSceneWithPreset(this.pendingPreset);
  }

  private initializeSceneWithPreset(preset: DecoratedCakePreset): void {
    if (!isPlatformBrowser(this.platformId) || !this.container?.nativeElement) {
      return;
    }

    this.sceneService.init(this.container.nativeElement, cloneCakeOptions(preset.options));
    this.sceneInitialized = true;
    this.options = cloneCakeOptions(preset.options);
    void this.sceneService.applyDecoratedCakePreset(preset);
  }

  ngOnDestroy(): void {
    if (this.statusTimeoutId !== null && isPlatformBrowser(this.platformId)) {
      window.clearTimeout(this.statusTimeoutId);
      this.statusTimeoutId = null;
    }

    this.anchorClickSubscription?.unsubscribe();

    if (isPlatformBrowser(this.platformId)) {
      document.removeEventListener('click', this.handleDocumentClick);
      document.removeEventListener('keydown', this.handleKeyDown);
      const containerEl = this.container?.nativeElement as HTMLElement | undefined;
      containerEl?.removeEventListener('contextmenu', this.contextMenuListener);
    }
  }

  onAddDecoration(request: AddDecorationRequest): void {
    void this.sceneService.addDecorationFromModel(request.modelFileName, request.preferredSurface, request.targetLayerIndex);
  }

  async onApplyCakePreset(preset: DecoratedCakePreset): Promise<void> {
    await this.sceneService.applyDecoratedCakePreset(preset);
    this.options = JSON.parse(JSON.stringify(preset.options));
    this.validationIssues = [];
    this.validationSummary = null;
  }

  updateCakeOptions(newOptions: CakeOptions): void {
    this.options = newOptions;
    this.sceneService.updateCakeOptions(newOptions);
  }

  onValidateDecorations(): void {
    const issues = this.sceneService.validateDecorations();
    const message = this.sceneService.buildValidationSummary(issues);
    this.validationIssues = issues;
    this.validationSummary = message;
    this.clearPendingValidationAction();
    this.showStatus(issues.length ? 'Znaleziono problemy z dekoracjami.' : 'Dekoracje rozmieszczone poprawnie.');
  }

  onTransformModeChange(mode: string): void {
    if (isPlatformBrowser(this.platformId)) {
      this.transformService.setTransformMode(mode as 'translate' | 'rotate' | 'scale');
    }
  }

  onTogglePaintMode(enabled: boolean): void {
    this.paintService.paintMode = enabled;
  }

  onBrushChanged(brushId: string): void {
    this.paintService.currentBrush = brushId;
  }

  onSaveScene(): void {
    if (!this.currentProjectId) {
      this.showStatus('Brak projektu do zapisania.');
      return;
    }

    const preset = this.sceneService.buildDecoratedCakePreset(this.projectName || 'Projekt tortu');
    const payload = {
      name: this.projectName || 'Projekt tortu',
      dataJson: JSON.stringify(preset),
    };

    this.projectsService.updateProject(this.currentProjectId, payload).subscribe({
      next: () => this.showStatus('Projekt zapisany.'),
      error: () => this.showStatus('Nie udało się zapisać projektu.'),
    });
  }

  onLogout(): void {
    this.authService.logout();
    void this.router.navigate(['/login']);
  }

  goToProjects(): void {
    void this.router.navigate(['/projects']);
  }

  onExportObj(): void {
    this.runWithValidation(
      () => {
        const data = this.sceneService.exportOBJ();
        const blob = new Blob([data], { type: 'text/plain' });
        this.triggerDownload(blob, 'cake-scene.obj');
      },
      'Eksport OBJ zakończony.',
      'Eksport OBJ',
    );
  }

  onExportStl(): void {
    this.runWithValidation(
      () => {
        const data = this.sceneService.exportSTL();
        const blob = new Blob([data], { type: 'application/sla' });
        this.triggerDownload(blob, 'cake-scene.stl');
      },
      'Eksport STL zakończony.',
      'Eksport STL',
    );
  }

  onExportGltf(): void {
    this.runWithValidation(
      () => {
        this.sceneService.exportGLTF((gltf) => {
          const serialized = JSON.stringify(gltf, null, 2);
          const blob = new Blob([serialized], { type: 'model/gltf+json' });
          this.triggerDownload(blob, 'cake-scene.gltf');
        });
      },
      'Eksport GLTF zakończony.',
      'Eksport GLTF',
    );
  }

  onScreenshot(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const dataUrl = this.sceneService.takeScreenshot();
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'cake-screenshot.png';
    link.click();
  }

  onProceedDespiteWarnings(): void {
    if (!this.pendingValidationAction) {
      return;
    }

    const action = this.pendingValidationAction;
    this.clearPendingValidationAction();
    action();
  }

  onContextSnapToCake(): void {
    this.hideContextMenu();
    const result = this.sceneService.snapSelectedDecorationToCake();
    this.showStatus(result.message);
  }

  onContextSnapToTop(): void {
    this.hideContextMenu();
    const result = this.sceneService.snapSelectedDecorationToSurface('TOP');
    this.showStatus(result.message);
  }

  onContextSnapToSide(): void {
    this.hideContextMenu();
    const result = this.sceneService.snapSelectedDecorationToSurface('SIDE');
    this.showStatus(result.message);
  }

  onContextAlignToSurface(): void {
    this.hideContextMenu();
    const result = this.sceneService.alignSelectedDecorationToSurface();
    this.showStatus(result.message);
  }

  onContextRotateQuarter(direction: 1 | -1): void {
    this.hideContextMenu();
    const result = this.sceneService.rotateSelectedDecorationQuarter(direction);
    this.showStatus(result.message);
  }

  onContextRotateHalf(): void {
    this.hideContextMenu();
    const result = this.sceneService.rotateSelectedDecorationHalf();
    this.showStatus(result.message);
  }

  onContextRotateDegrees(degrees: number): void {
    this.hideContextMenu();
    const result = this.sceneService.rotateSelectedDecorationByDegrees(degrees);
    this.showStatus(result.message);
  }

  onContextDeleteDecoration(): void {
    this.hideContextMenu();
    const result = this.sceneService.deleteSelectedDecoration();
    this.showStatus(result.message);
  }

  onContextCopyDecoration(): void {
    this.hideContextMenu();
    const result = this.sceneService.copySelectedDecoration();
    this.showStatus(result.message);
  }

  onContextPasteDecoration(): void {
    this.hideContextMenu();
    const result = this.sceneService.pasteDecoration();
    this.showStatus(result.message);
  }

  onContextResetOrientation(): void {
    this.hideContextMenu();
    const result = this.sceneService.resetSelectedDecorationOrientation();
    this.showStatus(result.message);
  }

  onContextLockDecoration(): void {
    this.hideContextMenu();
    const result = this.sceneService.lockSelectedDecoration();
    this.showStatus(result.message);
  }

  onContextUnlockDecoration(): void {
    this.hideContextMenu();
    const result = this.sceneService.unlockSelectedDecoration();
    this.showStatus(result.message);
  }

  onContextDeselectDecoration(): void {
    this.hideContextMenu();
    const deselected = this.sceneService.deselectDecoration();
    this.showStatus(deselected ? 'Zaznaczenie wyczyszczone.' : 'Brak zaznaczonej dekoracji.');
  }

  onContextResetCamera(): void {
    this.hideContextMenu();
    this.resetCameraView();
  }

  onToolbarResetCamera(): void {
    this.resetCameraView();
  }

  private async handleAnchorClick(anchorId: string): Promise<void> {
    const mode = this.anchorPresetsService.getActionMode();
    if (mode === 'move') {
      const result = this.sceneService.moveSelectionToAnchor(anchorId);
      this.showStatus(result.message);
      return;
    }

    const pendingDecoration = this.anchorPresetsService.getPendingDecoration();
    if (!pendingDecoration) {
      this.showStatus('Wybierz dekorację, aby dodać ją na kotwicy.');
      return;
    }

    const result = await this.sceneService.spawnDecorationAtAnchor(
      pendingDecoration.modelFileName,
      anchorId,
    );
    this.showStatus(result.message);
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private runWithValidation(action: () => void, successMessage: string, actionLabel: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const issues = this.sceneService.validateDecorations();
    const summary = this.sceneService.buildValidationSummary(issues);
    this.validationIssues = issues;
    this.validationSummary = summary;

    if (!issues.length) {
      this.clearPendingValidationAction();
      action();
      this.showStatus(successMessage);
      return;
    }

    this.pendingValidationAction = () => {
      action();
      this.showStatus(successMessage);
    };
    this.pendingValidationLabel = actionLabel;
    this.showStatus('Wykryto problemy z dekoracjami – sprawdź panel boczny.');
  }

  private clearPendingValidationAction(): void {
    this.pendingValidationAction = null;
    this.pendingValidationLabel = null;
  }

  private onContextMenu(event: MouseEvent): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (this.sceneService.isOrbitBusy() || (this.paintService.paintMode && this.paintService.isPainting)) {
      this.hideContextMenu();
      return;
    }
    this.hideContextMenu();

    this.sceneService.selectDecorationAt(event.clientX, event.clientY);
    const selected = this.sceneService.getSelectedDecoration();
    const isSnapped = this.sceneService.isSelectedDecorationSnapped();
    this.contextMenuHasSelection = !!selected;
    this.contextMenuCanSnap = !!selected && !isSnapped;
    this.contextMenuIsLocked = !!selected && this.sceneService.isSelectedDecorationLocked();

    this.contextMenuVisible = true;
    this.contextMenuX = event.clientX;
    this.contextMenuY = event.clientY;
  }

  private hideContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextMenuHasSelection = false;
    this.contextMenuCanSnap = false;
    this.contextMenuIsLocked = false;
  }

  private resetCameraView(): void {
    this.sceneService.resetCameraView();
    this.showStatus('Widok kamery został przywrócony.');
  }

  private shouldHandleResetShortcut(event: KeyboardEvent): boolean {
    if (event.key.toLowerCase() !== 'r' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return false;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return true;
    }

    const tagName = target.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable) {
      return false;
    }

    return true;
  }

  private showStatus(message: string): void {
    this.statusMessage = message;
    if (this.statusTimeoutId !== null && isPlatformBrowser(this.platformId)) {
      window.clearTimeout(this.statusTimeoutId);
    }

    if (isPlatformBrowser(this.platformId)) {
      this.statusTimeoutId = window.setTimeout(() => {
        this.statusMessage = null;
        this.statusTimeoutId = null;
      }, 3500);
    }
  }
}
