import {
  Component,
  AfterViewInit,
  ViewChild,
  ElementRef,
  Inject,
  PLATFORM_ID,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {CommonModule, isPlatformBrowser} from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {ThreeSceneService} from '../services/three-scene.service';
import {DecorationsService} from '../services/decorations.service';
import {PaintService} from '../services/paint.service';
import {TransformControlsService} from '../services/transform-controls-service';
import {CakeOptions, TextureMaps} from '../models/cake.options';
import {DecorationValidationIssue} from '../models/decoration-validation';
import {AddDecorationRequest} from '../models/add-decoration-request';
import {AnchorPresetsService} from '../services/anchor-presets.service';
import {Subscription} from 'rxjs';
import { environment } from '../../environments/environment';
import { DecoratedCakePreset } from '../models/cake-preset';
import { ProjectsService } from '../services/projects.service';
import { AuthService } from '../services/auth.service';
import { DEFAULT_CAKE_OPTIONS, cloneCakeOptions } from '../models/default-cake-options';
import { SceneOutlineNode } from '../models/scene-outline';

@Component({
  selector: 'app-cake-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cake-editor.component.html',
  styleUrls: ['./cake-editor.component.css']
})
export class CakeEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  mode: 'setup' | 'workspace' = 'setup';
  setupTab: 'cake' | 'texture' | 'color' | 'glaze' = 'cake';
  paintingMode: 'decor3d' | 'brush' | 'extruder' | 'sprinkles' = 'decor3d';
  activeWorkspacePanel: 'decor' | 'paint' = 'decor';
  selectedCakeSize: 'small' | 'medium' | 'large' = 'medium';
  selectedShape: 'cylinder' | 'cuboid' = 'cylinder';
  selectedLayers = 1;
  selectedTextureId = 'vanilla';
  gradientEnabled = false;
  gradientDirection: 'top-bottom' | 'bottom-top' = 'top-bottom';
  primaryColor = '#ffffff';
  gradientFirst = '#ffffff';
  gradientSecond = '#ffffff';
  glazeMode: 'taffla' | 'plain' = 'taffla';
  glazeEnabled = true;
  waferEnabled = false;
  waferZoom = 1;
  waferScale = 1;
  waferOffsetX = 0;
  waferOffsetY = 0;

  private textureBeforeGradient: TextureMaps | null = null;

  readonly setupTextures = [
    {
      id: 'vanilla',
      name: 'Wanilia',
      preview: '/assets/textures/Candy001_1K-JPG_Color.jpg',
      maps: {
        baseColor: '/assets/textures/Candy001_1K-JPG_Color.jpg',
        normal: '/assets/textures/Candy001_1K-JPG_NormalGL.jpg',
        roughness: '/assets/textures/cake_roughness.jpg',
        displacement: '/assets/textures/cake_bump.jpg',
      } as TextureMaps,
    },
    {
      id: 'choco-02',
      name: 'Czekolada 02',
      preview: '/assets/textures/Chocolate%2002_Albedo.jpg',
      maps: {
        baseColor: '/assets/textures/Chocolate%2002_Albedo.jpg',
        normal: '/assets/textures/Chocolate%2002_Normal.jpg',
        roughness: '/assets/textures/Chocolate%2002_Roughness.jpg',
        displacement: '/assets/textures/Chocolate%2002_Displacement.jpg',
      } as TextureMaps,
    },
    {
      id: 'choco-03',
      name: 'Czekolada 03',
      preview: '/assets/textures/Chocolate%2003_Albedo.jpg',
      maps: {
        baseColor: '/assets/textures/Chocolate%2003_Albedo.jpg',
        normal: '/assets/textures/Chocolate%2003_Normal.jpg',
        roughness: '/assets/textures/Chocolate%2003_Roughness.jpg',
        displacement: '/assets/textures/Chocolate%2003_Displacement.jpg',
      } as TextureMaps,
    },
    {
      id: 'food-choco',
      name: 'Tabliczka czekolady',
      preview: '/assets/textures/Food_Chocolate_basecolor.jpg',
      maps: {
        baseColor: '/assets/textures/Food_Chocolate_basecolor.jpg',
        normal: '/assets/textures/Food_Chocolate_normal.jpg',
        roughness: '/assets/textures/Food_Chocolate_roughness.jpg',
        displacement: '/assets/textures/Food_Chocolate_height.jpg',
        ambientOcclusion: '/assets/textures/Food_Chocolate_ambientocclusion.jpg',
      } as TextureMaps,
    },
    {
      id: 'pink-candy',
      name: 'Pink Candy',
      preview: '/assets/textures/Pink%20Candy_BaseColor.jpg',
      maps: {
        baseColor: '/assets/textures/Pink%20Candy_BaseColor.jpg',
        normal: '/assets/textures/Pink%20Candy_Normal.jpg',
        roughness: '/assets/textures/Pink%20Candy_Roughness.jpg',
        displacement: '/assets/textures/Pink%20Candy_Displacement.jpg',
        metallic: '/assets/textures/Pink%20Candy_Metallic.jpg',
        emissive: '/assets/textures/Pink%20Candy_Emissive.jpg',
        alpha: '/assets/textures/Pink%20Candy_Alpha.jpg',
      } as TextureMaps,
    },
    {
      id: 'pink-frosting',
      name: 'Pink Frosting',
      preview: '/assets/textures/Pink_Cake_Frosting_01-diffuse.jpg',
      maps: {
        baseColor: '/assets/textures/Pink_Cake_Frosting_01-diffuse.jpg',
        normal: '/assets/textures/Pink_Cake_Frosting_01-normal.jpg',
        roughness: '/assets/textures/Pink_Cake_Frosting_01-bump.jpg',
        displacement: '/assets/textures/Pink_Cake_Frosting_01-bump.jpg',
      } as TextureMaps,
    },
  ];
  private container?: ElementRef;
  @ViewChild('canvasContainer') set canvasContainer(element: ElementRef | undefined) {
    const hasChanged = !!element && this.container?.nativeElement !== element.nativeElement;
    if (hasChanged && this.sceneInitialized) {
      this.pendingPreset = this.sceneService.buildDecoratedCakePreset(this.projectName || 'Projekt tortu');
      this.sceneInitialized = false;
    }
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

  public sceneOutline: SceneOutlineNode | null = null;
  public sceneSelectedNodeId: string | null = null;
  public sceneExpandedNodes = new Set<string>();

  private pendingValidationAction: (() => void) | null = null;
  private statusTimeoutId: number | null = null;
  private anchorClickSubscription?: Subscription;
  private outlineSubscription?: Subscription;

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
      this.loadError = null;
      this.pendingPreset = {
        id: 'new-project',
        name: 'Nowy tort',
        options: cloneCakeOptions(DEFAULT_CAKE_OPTIONS),
        decorations: [],
      };
      this.options = cloneCakeOptions(DEFAULT_CAKE_OPTIONS);
      this.maybeInitializeScene();
    }

    this.syncSetupStateWithOptions();
    this.outlineSubscription = this.sceneService.outlineChanges$.subscribe(() =>
      this.refreshSceneOutline(),
    );
    this.refreshSceneOutline();
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
        this.syncSetupStateWithOptions();
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
    this.outlineSubscription?.unsubscribe();

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
    this.syncSetupStateWithOptions();
  }

  continueToWorkspace(): void {
    this.mode = 'workspace';
    this.activeWorkspacePanel = 'decor';
    this.paintingMode = 'decor3d';
    if (this.sceneInitialized) {
      this.pendingPreset = this.sceneService.buildDecoratedCakePreset(this.projectName || 'Projekt tortu');
      this.sceneInitialized = false;
    }
    this.maybeInitializeScene();
  }

  refreshSceneOutline(): void {
    this.sceneOutline = this.sceneService.getSceneOutline();
    this.sceneSelectedNodeId = this.sceneService.getSelectedDecorationId();
    this.ensureSceneRootExpanded(this.sceneOutline);
  }

  trackSceneNode(_: number, node: SceneOutlineNode): string {
    return node.id;
  }

  isSceneNodeExpanded(nodeId: string): boolean {
    return this.sceneExpandedNodes.has(nodeId);
  }

  toggleSceneNodeExpanded(nodeId: string): void {
    if (this.sceneExpandedNodes.has(nodeId)) {
      this.sceneExpandedNodes.delete(nodeId);
    } else {
      this.sceneExpandedNodes.add(nodeId);
    }
  }

  selectSceneNode(node: SceneOutlineNode): void {
    if (!this.isSceneNodeSelectable(node)) {
      return;
    }

    const success = this.sceneService.selectDecorationById(node.id);
    this.sceneSelectedNodeId = success ? node.id : this.sceneSelectedNodeId;
  }

  toggleSceneNodeVisibility(node: SceneOutlineNode): void {
    if (!this.isSceneNodeSelectable(node)) {
      return;
    }

    const nextState = !node.visible;
    const changed = this.sceneService.setDecorationVisibility(node.id, nextState);
    if (changed) {
      this.refreshSceneOutline();
    }
  }

  private isSceneNodeSelectable(node: SceneOutlineNode): boolean {
    return node.type === 'decoration' || node.type === 'group';
  }

  private ensureSceneRootExpanded(node: SceneOutlineNode | null): void {
    if (!node) {
      return;
    }

    if (!this.sceneExpandedNodes.size) {
      this.sceneExpandedNodes.add(node.id);
      node.children.forEach((child) => this.sceneExpandedNodes.add(child.id));
    }
  }

  selectSetupTab(tab: 'cake' | 'texture' | 'color' | 'glaze'): void {
    this.setupTab = tab;
  }

  selectCakeSize(size: 'small' | 'medium' | 'large'): void {
    this.selectedCakeSize = size;
    this.applyLayerSizing(this.selectedLayers, this.getBaseWidth(size));
  }

  selectShape(shape: 'cylinder' | 'cuboid'): void {
    this.selectedShape = shape;
    this.patchOptions({ shape });
  }

  selectLayers(layers: number): void {
    this.selectedLayers = layers;
    this.applyLayerSizing(layers, this.getBaseWidth());
  }

  selectTexture(textureId: string): void {
    const match = this.setupTextures.find((t) => t.id === textureId);
    this.selectedTextureId = textureId;
    if (!match) {
      return;
    }
    this.gradientEnabled = false;
    this.textureBeforeGradient = null;
    this.patchOptions({
      cake_textures: match.maps,
      cake_color: '#ffffff',
    });
  }

  getInputValue(event: Event): string {
    const target = event.target as HTMLInputElement | null;
    return target?.value ?? '';
  }

  setCakeColor(color: string): void {
    this.primaryColor = color;
    this.gradientEnabled = false;
    this.patchOptions({ cake_color: color, cake_textures: null });
  }

  setGradientColor(which: 'first' | 'second', color: string): void {
    if (which === 'first') {
      this.gradientFirst = color;
    } else {
      this.gradientSecond = color;
    }

    if (this.gradientEnabled) {
      this.applyGradientTexture();
    }
  }

  toggleGradient(enabled: boolean): void {
    this.gradientEnabled = enabled;
    if (enabled) {
      this.textureBeforeGradient = this.options.cake_textures ?? null;
      this.applyGradientTexture();
    } else {
      this.patchOptions({ cake_color: this.primaryColor, cake_textures: this.textureBeforeGradient });
    }
  }

  setGradientDirection(direction: 'top-bottom' | 'bottom-top'): void {
    this.gradientDirection = direction;
    if (this.gradientEnabled) {
      this.applyGradientTexture();
    }
  }

  toggleGlaze(enabled: boolean): void {
    this.glazeEnabled = enabled;
    this.patchOptions({ glaze_enabled: enabled });
  }

  setGlazeMode(mode: 'taffla' | 'plain'): void {
    this.glazeMode = mode;
    this.patchOptions({ glaze_top_enabled: mode === 'taffla' });
  }

  setGlazeColor(color: string): void {
    this.patchOptions({ glaze_color: color });
  }

  toggleWafer(enabled: boolean): void {
    this.waferEnabled = enabled;
    const fallback = this.options.wafer_texture_url ?? '/assets/textures/Pink%20Candy_BaseColor.jpg';
    this.patchOptions({ wafer_texture_url: enabled ? fallback : null });
    if (!enabled) {
      this.waferScale = 1;
      this.waferZoom = 1;
      this.waferOffsetX = 0;
      this.waferOffsetY = 0;
    }
  }

  setWaferColor(color: string): void {
    if (this.waferEnabled) {
      this.patchOptions({ glaze_color: color });
    }
  }

  setWaferScale(scale: number): void {
    this.waferScale = scale;
    this.patchOptions({ wafer_scale: scale });
  }

  setWaferZoom(zoom: number): void {
    this.waferZoom = zoom;
    this.patchOptions({ wafer_texture_zoom: zoom });
  }

  setWaferOffset(axis: 'x' | 'y', value: number): void {
    if (axis === 'x') {
      this.waferOffsetX = value;
      this.patchOptions({ wafer_texture_offset_x: value });
    } else {
      this.waferOffsetY = value;
      this.patchOptions({ wafer_texture_offset_y: value });
    }
  }

  private getBaseWidth(size: 'small' | 'medium' | 'large' = this.selectedCakeSize): number {
    if (size === 'small') return 0.9;
    if (size === 'large') return 1.2;
    return 1;
  }

  private applyLayerSizing(layers: number, baseWidth: number): void {
    const widenedBase = baseWidth + (layers - 1) * 0.2;
    const sizes = Array.from({ length: layers }, (_, idx) => Math.max(0.6, widenedBase - idx * 0.2));
    this.patchOptions({ layers, layerSizes: sizes, cake_size: 1 });
  }

  onWaferFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      this.patchOptions({ wafer_texture_url: result });
    };
    reader.readAsDataURL(file);
  }

  selectPaintingMode(mode: 'decor3d' | 'brush' | 'extruder' | 'sprinkles'): void {
    this.paintingMode = mode;
    if (this.activeWorkspacePanel === 'paint') {
      this.onTogglePaintMode(mode !== 'decor3d');
    }
  }

  openDecorPanel(): void {
    this.activeWorkspacePanel = 'decor';
    this.paintingMode = 'decor3d';
    this.onTogglePaintMode(false);
  }

  openPaintPanel(mode: 'decor3d' | 'brush' | 'extruder' | 'sprinkles' = this.paintingMode): void {
    this.activeWorkspacePanel = 'paint';
    this.selectPaintingMode(mode);
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

  private patchOptions(partial: Partial<CakeOptions>): void {
    const merged: CakeOptions = {
      ...this.options,
      ...partial,
    };
    this.updateCakeOptions(merged);
  }

  private applyGradientTexture(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const startY = this.gradientDirection === 'top-bottom' ? 0 : canvas.height;
    const endY = this.gradientDirection === 'top-bottom' ? canvas.height : 0;
    const gradient = ctx.createLinearGradient(canvas.width / 2, startY, canvas.width / 2, endY);
    gradient.addColorStop(0, this.gradientFirst);
    gradient.addColorStop(1, this.gradientSecond);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/png');
    const texture: TextureMaps = { baseColor: dataUrl, repeat: 1 };
    this.patchOptions({ cake_color: this.gradientFirst, cake_textures: texture });
  }

  private syncSetupStateWithOptions(): void {
    const baseLayer = this.options.layerSizes?.[0] ?? 1;
    this.selectedCakeSize = baseLayer < 0.95 ? 'small' : baseLayer > 1.05 ? 'large' : 'medium';
    this.selectedShape = this.options.shape;
    this.selectedLayers = this.options.layers;
    this.primaryColor = this.options.cake_color;
    this.gradientFirst = this.options.cake_color;
    this.gradientSecond = this.gradientSecond || '#ffffff';
    this.glazeEnabled = this.options.glaze_enabled;
    this.glazeMode = this.options.glaze_top_enabled ? 'taffla' : 'plain';
    this.waferEnabled = !!this.options.wafer_texture_url;
    this.waferScale = this.options.wafer_scale ?? 1;
    this.waferZoom = this.options.wafer_texture_zoom ?? 1;
    this.waferOffsetX = this.options.wafer_texture_offset_x ?? 0;
    this.waferOffsetY = this.options.wafer_texture_offset_y ?? 0;
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
