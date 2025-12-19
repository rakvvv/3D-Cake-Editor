import {
  Component,
  AfterViewInit,
  ViewChild,
  ElementRef,
  Inject,
  PLATFORM_ID,
  OnDestroy,
  OnInit,
  ChangeDetectorRef,
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
import { SurfacePaintingService } from '../services/surface-painting.service';
import {Subscription, lastValueFrom} from 'rxjs';
import { environment } from '../../environments/environment';
import { DecoratedCakePreset } from '../models/cake-preset';
import { ProjectsService } from '../services/projects.service';
import { AuthService } from '../services/auth.service';
import { DEFAULT_CAKE_OPTIONS, cloneCakeOptions } from '../models/default-cake-options';
import { SceneOutlineNode } from '../models/scene-outline';
import { EditorSidebarComponent } from './sidebar/editor-sidebar.component';
import { SidebarExportPanelComponent } from './sidebar/panels/sidebar-export-panel.component';
import { BrushSettings, SidebarPanelKey, SidebarPaintMode } from './sidebar/sidebar.types';
import { TexturesService } from '../services/textures.service';
import { TextureMapsMetadata, TextureSet } from '../models/texture-set';
import * as THREE from 'three';

type HelperSettings = {
  grid: boolean;
  axes: boolean;
  bounding: boolean;
  highQuality: boolean;
};

type TexturePreviewLayers = {
  previewImage: string | null;
  previewOverlay: string | null;
  previewColor: string | null;
};

type TexturePickerOption = TexturePreviewLayers & {
  id: string;
  label: string;
  target: 'cake' | 'glaze';
  maps: TextureMaps;
  isCustomColorizable: boolean;
};

type CameraOption = 'perspective' | 'orthographic' | 'isometric' | 'top' | 'front' | 'right';

@Component({
  selector: 'app-cake-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, EditorSidebarComponent, SidebarExportPanelComponent],
  templateUrl: './cake-editor.component.html',
  styleUrls: ['./cake-editor.component.css']
})
export class CakeEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  mode: 'setup' | 'workspace' = 'setup';
  setupTab: 'cake' | 'texture' | 'color' | 'glaze' = 'cake';
  paintingMode: SidebarPaintMode = 'decor3d';
  activeSidebarPanel: SidebarPanelKey = 'decorations';
  selectedCakeSize: 'small' | 'medium' | 'large' = 'medium';
  selectedShape: 'cylinder' | 'cuboid' = 'cylinder';
  selectedLayers = 1;
  gradientEnabled = false;
  gradientDirection: 'top-bottom' | 'bottom-top' = 'top-bottom';
  primaryColor = '#ffffff';
  gradientFirst = '#ffffff';
  gradientSecond = '#ffffff';
  glazeMode: 'taffla' | 'plain' = 'plain';
  glazeEnabled = false;
  waferEnabled = false;
  waferZoom = 1;
  waferScale = 1;
  waferOffsetX = 0;
  waferOffsetY = 0;
  waferMask: 'circle' | 'square' = 'circle';
  waferPerspective = 0;
  waferLoadError: string | null = null;
  setupLocked = false;
  canUndoAction = false;
  canRedoAction = false;
  isAdmin = false;

  private static readonly GLAZE_PREVIEW_COLORS: Record<string, string> = {
    'chocolate-cake-02': '#5c3b28',
    'chocolate-cake-03': '#f1e5d2',
    polewa: '#ffffff',
  };

  private textureBeforeGradient: TextureMaps | null = null;
  selectedCakeTextureId: string | null = null;
  selectedGlazeTextureId: string | null = null;
  cakeTextureOptions: TexturePickerOption[] = [];
  glazeTextureOptions: TexturePickerOption[] = [];
  textureLoadError: string | null = null;
  private waferImage: HTMLImageElement | null = null;
  private waferPreviewFrame: number | null = null;
  private waferDragStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null;
  private container?: ElementRef;
  @ViewChild('canvasContainer') set canvasContainer(element: ElementRef | undefined) {
    const hasChanged = !!element && this.container?.nativeElement !== element.nativeElement;
    if (hasChanged && this.sceneInitialized && element) {
      this.sceneService.reattachRenderer(element.nativeElement);
    }
    this.container = element;
    if (this.viewReady) {
      this.rebindCanvasListeners();
      if (hasChanged && this.sceneInitialized) {
        this.sceneService.requestRender();
      }
    }
    this.maybeInitializeScene();
  }
  @ViewChild(EditorSidebarComponent) sidebar?: EditorSidebarComponent;
  @ViewChild('waferCanvas') waferCanvas?: ElementRef<HTMLCanvasElement>;

  readonly authorModeEnabled = environment.authorMode;

  public options: CakeOptions = cloneCakeOptions(DEFAULT_CAKE_OPTIONS);

  public projectName = '';
  public loadingProject = true;
  public loadError: string | null = null;
  private currentProjectId: number | null = null;
  private currentProjectThumbnailUrl: string | null = null;
  private pendingPreset: DecoratedCakePreset | null = null;
  private sceneInitialized = false;
  private viewReady = false;

  public validationSummary: string | null = null;
  public validationIssues: DecorationValidationIssue[] = [];
  public pendingValidationLabel: string | null = null;
  public statusMessage: string | null = null;

  public paintBrushId = 'trawa.glb';
  public paintColor = '#ff4d6d';
  public penSize = 0.05;
  public penThickness = 0.02;
  public penOpacity = 1;
  public paintingPowerEnabled = true;

  public helperMenuOpen = false;
  public helpersMasterVisible = false;
  public helperSettings: HelperSettings = {
    grid: false,
    axes: false,
    bounding: false,
    highQuality: true,
  };
  private helperSnapshot: Partial<HelperSettings> = {};
  public cameraDropdownOpen = false;
  public cameraMode: 'perspective' | 'orthographic' = 'perspective';
  public cameraPreset: 'default' | 'isometric' | 'top' | 'front' | 'right' = 'default';
  public horizontalOrbitLock = false;
  public sceneBackground: 'light' | 'dark' = 'dark';

  public contextMenuVisible = false;
  public contextMenuX = 0;
  public contextMenuY = 0;
  public contextMenuHasSelection = false;
  public contextMenuCanSnap = false;
  public contextMenuIsLocked = false;
  public sceneTreeScale = 0.95;
  public exportPopupOpen = false;

  public sceneOutline: SceneOutlineNode | null = null;
  public sceneSelectedNodeId: string | null = null;
  public sceneExpandedNodes = new Set<string>();

  private pendingValidationAction: (() => void) | null = null;
  private statusTimeoutId: number | null = null;
  private anchorClickSubscription?: Subscription;
  private outlineSubscription?: Subscription;
  private paintSceneSubscription?: Subscription;
  private userSubscription?: Subscription;
  private texturesSubscription?: Subscription;
  private readonly customCakeTextureIds = new Set(['frosting', 'chocolate-cake-03']);
  private readonly customGlazeTextureIds = new Set(['polewa']);
  private canvasListenerTarget?: HTMLElement;
  private rightClickDrag?: { x: number; y: number; moved: boolean };

  private readonly handleDocumentClick = () => {
    this.hideContextMenu();
    this.helperMenuOpen = false;
    this.cameraDropdownOpen = false;
  };
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.hideContextMenu();
      this.closeExportPopup();
      return;
    }

    if (this.shouldHandleResetShortcut(event)) {
      event.preventDefault();
      this.resetCameraView();
      return;
    }

    if (this.shouldHandleFocusShortcut(event)) {
      event.preventDefault();
      this.onFocusButtonClick();
    }
  };

  private contextMenuListener = (event: MouseEvent) => this.onContextMenu(event);
  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      this.rightClickDrag = { x: event.clientX, y: event.clientY, moved: false };
    } else {
      this.rightClickDrag = undefined;
    }
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.rightClickDrag || (event.buttons & 2) === 0) {
      return;
    }

    const deltaX = Math.abs(event.clientX - this.rightClickDrag.x);
    const deltaY = Math.abs(event.clientY - this.rightClickDrag.y);
    if (deltaX > 4 || deltaY > 4) {
      this.rightClickDrag.moved = true;
    }
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 2) {
      return;
    }

    const drag = this.rightClickDrag;
    this.rightClickDrag = undefined;
    const orbitBusy = this.sceneService.isOrbitBusy();
    const paintBusy = this.paintService.paintMode && this.paintService.isPainting;
    const allowDespiteOrbit = !!drag && !drag.moved;
    if ((orbitBusy && !allowDespiteOrbit) || paintBusy || drag?.moved) {
      this.hideContextMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.sceneService.selectDecorationAt(event.clientX, event.clientY);
    this.openContextMenuAt(event.clientX, event.clientY);
  };

  constructor(
    public readonly sceneService: ThreeSceneService,
    private transformService: TransformControlsService,
    private decorationsService: DecorationsService,
    private paintService: PaintService,
    private surfacePaintingService: SurfacePaintingService,
    private anchorPresetsService: AnchorPresetsService,
    private projectsService: ProjectsService,
    private texturesService: TexturesService,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private changeDetectorRef: ChangeDetectorRef,
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

    this.loadTextureSets();
    this.syncSetupStateWithOptions();
    this.outlineSubscription = this.sceneService.outlineChanges$.subscribe(() =>
      this.refreshSceneOutline(),
    );
    this.refreshSceneOutline();

    void this.anchorPresetsService.loadPresets();

    this.isAdmin = this.authService.getCurrentUser()?.role === 'ADMIN';
    this.userSubscription = this.authService.currentUser$.subscribe((user) => {
      this.isAdmin = user?.role === 'ADMIN';
    });

    this.paintBrushId = this.paintService.currentBrush;
    this.paintColor = this.paintService.penColor;
    this.penSize = this.paintService.penSize;
    this.penThickness = this.paintService.penThickness;
    this.penOpacity = this.paintService.penOpacity;

    this.refreshUndoRedoAvailability();
    this.paintSceneSubscription = this.paintService.sceneChanged$.subscribe(() => {
      this.refreshUndoRedoAvailability();
      this.updateSetupLockState();
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.maybeInitializeScene();
    if (isPlatformBrowser(this.platformId)) {
      this.anchorClickSubscription = this.anchorPresetsService.anchorClicks$.subscribe((anchorId) => {
        void this.handleAnchorClick(anchorId);
      });
      const containerEl = this.container?.nativeElement as HTMLElement | undefined;
      this.rebindCanvasListeners(containerEl);
      document.addEventListener('click', this.handleDocumentClick);
      document.addEventListener('keydown', this.handleKeyDown);
    }
    this.scheduleWaferPreviewRender();
  }

  private loadProject(projectId: number): void {
    this.loadingProject = true;
    this.projectsService.getProject(projectId).subscribe({
      next: (detail) => {
        this.projectName = detail.name;
        this.currentProjectThumbnailUrl = detail.thumbnailUrl ?? null;
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

  private loadTextureSets(): void {
    this.texturesSubscription?.unsubscribe();
    this.texturesSubscription = this.texturesService.loadTextureSets().subscribe({
      next: (sets: TextureSet[]) => {
        this.textureLoadError = null;
        this.applyTextureSets(sets);
      },
      error: () => {
        this.textureLoadError = 'Nie udało się wczytać listy tekstur.';
      },
    });
  }

  private applyTextureSets(sets: TextureSet[]): void {
    const cakeOptions: TexturePickerOption[] = [];
    const glazeOptions: TexturePickerOption[] = [];

    sets.forEach((set) => {
      const cakeOption = this.toTexturePickerOption(set, 'cake');
      const glazeOption = this.toTexturePickerOption(set, 'glaze');

      if (cakeOption) {
        cakeOptions.push(cakeOption);
      }

      if (glazeOption && !this.shouldOmitGlazeOption(set)) {
        glazeOptions.push(glazeOption);
      }
    });

    this.cakeTextureOptions = cakeOptions;
    this.glazeTextureOptions = glazeOptions;
    this.syncSelectedTextures();
  }

  private shouldOmitGlazeOption(set: TextureSet): boolean {
    const label = (set.label || '').toLowerCase();
    return label.includes('różowa cukierkowa');
  }

  private syncSelectedTextures(): void {
    this.selectedCakeTextureId = this.findMatchingTextureId(
      this.options.cake_textures,
      this.cakeTextureOptions,
    );
    this.selectedGlazeTextureId = this.findMatchingTextureId(
      this.options.glaze_textures,
      this.glazeTextureOptions,
    );
  }

  private findMatchingTextureId(
    target: TextureMaps | null | undefined,
    options: TexturePickerOption[],
  ): string | null {
    if (!target) {
      return null;
    }

    const match = options.find((option) => this.areTextureMapsEqual(option.maps, target));
    return match?.id ?? null;
  }

  private toTexturePickerOption(
    set: TextureSet,
    target: 'cake' | 'glaze',
  ): TexturePickerOption | null {
    const maps = target === 'cake' ? set.cake : set.glaze;
    if (!maps) {
      return null;
    }

    const normalizedMaps = this.normalizeTextureMaps(maps);
    const previewLayers =
      target === 'glaze'
        ? this.pickGlazePreviewLayers(set, normalizedMaps)
        : this.pickTexturePreviewLayers(set.thumbnailUrl, normalizedMaps);

    return {
      id: set.id,
      label: this.normalizeTextureLabel(set, target),
      target,
      maps: normalizedMaps,
      isCustomColorizable: this.isCustomTexture(set.id, target),
      ...previewLayers,
    };
  }

  private areTextureMapsEqual(
    first: TextureMaps | undefined,
    second: TextureMaps | null | undefined,
  ): boolean {
    if (!first || !second) {
      return false;
    }

    return (
      first.baseColor === second.baseColor &&
      first.normal === second.normal &&
      first.roughness === second.roughness &&
      first.displacement === second.displacement &&
      first.metallic === second.metallic &&
      first.emissive === second.emissive &&
      first.ambientOcclusion === second.ambientOcclusion &&
      first.alpha === second.alpha &&
      first.affectDrips === second.affectDrips &&
      first.repeat === second.repeat
    );
  }

  get cakeColorEditable(): boolean {
    return !this.selectedCakeTextureId || this.isCustomTexture(this.selectedCakeTextureId, 'cake');
  }

  get glazeColorEditable(): boolean {
    return !this.selectedGlazeTextureId || this.isCustomTexture(this.selectedGlazeTextureId, 'glaze');
  }

  buildTexturePreviewStyle(option: TexturePickerOption): Record<string, string> {
    const layers: string[] = [];
    if (option.previewOverlay) {
      layers.push(`url(${option.previewOverlay})`);
    }

    if (option.previewImage) {
      layers.push(`url(${option.previewImage})`);
    } else if (option.previewColor) {
      layers.push(`linear-gradient(${option.previewColor}, ${option.previewColor})`);
    }

    const blendMode = option.previewOverlay ? 'overlay, normal' : '';

    return {
      'background-image': layers.join(', '),
      'background-color': option.previewColor ?? '',
      'background-blend-mode': blendMode,
    };
  }

  private normalizeTextureMaps(
    maps: TextureMaps | TextureMapsMetadata | null | undefined,
  ): TextureMaps {
    if (!maps) {
      return {};
    }

    const normalized: TextureMaps = {
      ...maps,
      baseColor: this.normalizeTextureUrl(maps.baseColor),
      normal: this.normalizeTextureUrl(maps.normal),
      roughness: this.normalizeTextureUrl(maps.roughness),
      displacement: this.normalizeTextureUrl(maps.displacement),
      metallic: this.normalizeTextureUrl(maps.metallic),
      emissive: this.normalizeTextureUrl(maps.emissive),
      ambientOcclusion: this.normalizeTextureUrl(maps.ambientOcclusion),
      alpha: this.normalizeTextureUrl(maps.alpha),
      affectDrips: maps.affectDrips ?? undefined,
      repeat: maps.repeat ?? undefined,
    };

    return normalized;
  }

  private pickTexturePreviewLayers(
    thumbnailUrl: string | null | undefined,
    maps: TextureMaps,
  ): TexturePreviewLayers {
    const previewImage =
      this.normalizeTextureUrl(thumbnailUrl) ||
      this.normalizeTextureUrl(!this.isProbablyColor(maps.baseColor) ? maps.baseColor : null);

    const previewColor = this.isProbablyColor(maps.baseColor) ? maps.baseColor ?? null : null;
    const previewOverlay = this.pickTextureOverlay(maps);
    const overlayFallback = !previewImage && !previewColor ? previewOverlay : null;

    return {
      previewImage: previewImage || overlayFallback || null,
      previewOverlay,
      previewColor,
    };
  }

  private pickGlazePreviewLayers(set: TextureSet, maps: TextureMaps): TexturePreviewLayers {
    const previewColor =
      (this.isProbablyColor(maps.baseColor) ? maps.baseColor : null) ||
      this.lookupGlazePreviewColor(set.id) ||
      '#ffffff';

    return {
      previewImage: null,
      previewOverlay: null,
      previewColor,
    };
  }

  private lookupGlazePreviewColor(textureId: string): string | null {
    return CakeEditorComponent.GLAZE_PREVIEW_COLORS[textureId] ?? null;
  }

  private pickTextureOverlay(maps: TextureMaps): string | null {
    const candidates = [
      maps.normal,
      maps.roughness,
      maps.displacement,
      maps.metallic,
      maps.ambientOcclusion,
      maps.emissive,
      maps.alpha,
    ];

    for (const candidate of candidates) {
      if (candidate && !this.isProbablyColor(candidate)) {
        return this.normalizeTextureUrl(candidate);
      }
    }

    return null;
  }

  private normalizeTextureLabel(set: TextureSet, target: 'cake' | 'glaze'): string {
    if (target === 'glaze') {
      return set.id === 'polewa' ? 'Niestandardowa polewa' : set.label;
    }

    if (set.id === 'frosting') {
      return 'Niestandardowy krem';
    }

    if (set.id === 'chocolate-cake-03') {
      return 'Niestandardowy krem 2';
    }

    return set.label;
  }

  private isCustomTexture(id: string, target: 'cake' | 'glaze'): boolean {
    return target === 'cake' ? this.customCakeTextureIds.has(id) : this.customGlazeTextureIds.has(id);
  }

  private isProbablyColor(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }

    return /^#|^rgb\(/i.test(value.trim());
  }

  private normalizeTextureUrl(url: string | null | undefined): string | null {
    if (!url) {
      return null;
    }

    try {
      return encodeURI(decodeURI(url));
    } catch {
      return encodeURI(url);
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
    this.sceneBackground = this.sceneService.getBackgroundMode();
    this.applyHelperSettings();
    this.sceneService.setCameraMode(this.cameraMode);
    this.sceneService.setCameraPreset(this.cameraPreset);
    this.sceneService.setHorizontalOrbitLock(this.horizontalOrbitLock);
    void this.sceneService.applyDecoratedCakePreset(preset);
    this.updateSetupLockState();
  }

  ngOnDestroy(): void {
    if (this.statusTimeoutId !== null && isPlatformBrowser(this.platformId)) {
      window.clearTimeout(this.statusTimeoutId);
      this.statusTimeoutId = null;
    }

    this.anchorClickSubscription?.unsubscribe();
    this.outlineSubscription?.unsubscribe();
    this.paintSceneSubscription?.unsubscribe();
    this.userSubscription?.unsubscribe();
    this.texturesSubscription?.unsubscribe();

    if (isPlatformBrowser(this.platformId)) {
      this.teardownCanvasListeners();
      document.removeEventListener('click', this.handleDocumentClick);
      document.removeEventListener('keydown', this.handleKeyDown);
      if (this.waferPreviewFrame !== null) {
        cancelAnimationFrame(this.waferPreviewFrame);
      }
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

  toggleHelperMenu(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.cameraDropdownOpen = false;
    this.helperMenuOpen = !this.helperMenuOpen;
  }

  toggleHelpersVisibility(): void {
    const nextVisible = !this.helpersMasterVisible;
    if (!nextVisible) {
      this.helperSnapshot = { ...this.helperSettings };
      this.helperSettings = {
        ...this.helperSettings,
        grid: false,
        axes: false,
        bounding: false,
      };
    } else {
      const restored: HelperSettings = {
        grid: true,
        axes: true,
        bounding: true,
        highQuality: this.helperSettings.highQuality,
        ...this.helperSnapshot,
      };
      this.helperSettings = restored;
    }

    this.helpersMasterVisible = nextVisible;
    this.applyHelperSettings();
  }

  toggleHelperFlag(key: keyof HelperSettings): void {
    this.helperSettings = {
      ...this.helperSettings,
      [key]: !this.helperSettings[key],
    };
    this.helpersMasterVisible =
      this.helperSettings.grid || this.helperSettings.axes || this.helperSettings.bounding;
    this.applyHelperSettings();
  }

  private applyHelperSettings(): void {
    const enabled = this.helpersMasterVisible;
    this.sceneService.setGridVisible(enabled && this.helperSettings.grid);
    this.sceneService.setAxesVisible(enabled && this.helperSettings.axes);
    this.sceneService.setBoundingBoxesVisible(enabled && this.helperSettings.bounding);
    this.sceneService.setHighQualityMode(this.helperSettings.highQuality);
  }

  toggleCameraDropdown(event?: Event): void {
    event?.stopPropagation();
    this.helperMenuOpen = false;
    this.cameraDropdownOpen = !this.cameraDropdownOpen;
  }

  selectCameraOption(option: CameraOption): void {
    this.cameraDropdownOpen = false;
    this.cameraPreset = option === 'perspective' || option === 'orthographic' ? 'default' : option;
    this.cameraMode = option === 'perspective' ? 'perspective' : 'orthographic';

    if (option === 'perspective') {
      this.sceneService.setCameraMode('perspective');
      this.sceneService.setCameraPreset('default');
    } else if (option === 'orthographic') {
      this.sceneService.setCameraMode('orthographic');
      this.sceneService.setCameraPreset('default');
    } else {
      this.sceneService.setCameraPreset(option);
    }

    this.showStatus(`Tryb kamery: ${this.resolveCameraLabel(option)}.`);
  }

  toggleHorizontalOrbitLock(): void {
    this.horizontalOrbitLock = !this.horizontalOrbitLock;
    this.sceneService.setHorizontalOrbitLock(this.horizontalOrbitLock);
    this.showStatus(this.horizontalOrbitLock ? 'Orbita zablokowana do poziomu.' : 'Orbita odblokowana.');
  }

  getCameraLabel(): string {
    if (this.cameraPreset !== 'default') {
      return this.resolveCameraLabel(this.cameraPreset);
    }

    return this.resolveCameraLabel(this.cameraMode);
  }

  private resolveCameraLabel(option: CameraOption): string {
    switch (option) {
      case 'orthographic':
        return 'Orthographic';
      case 'isometric':
        return 'Isometric';
      case 'top':
        return 'Top';
      case 'front':
        return 'Front';
      case 'right':
        return 'Right';
      default:
        return 'Perspective';
    }
  }

  continueToWorkspace(): void {
    this.mode = 'workspace';
    this.activeSidebarPanel = 'decorations';
    this.paintingMode = 'decor3d';
    this.maybeInitializeScene();
  }

  refreshSceneOutline(): void {
    this.sceneOutline = this.sceneService.getSceneOutline();
    this.sceneSelectedNodeId = this.sceneService.getSelectedDecorationId();
    this.ensureSceneRootExpanded(this.sceneOutline);
    this.updateSetupLockState();
  }

  trackSceneNode(_: number, node: SceneOutlineNode): string {
    return node.id;
  }

  isSceneNodeExpanded(node: SceneOutlineNode): boolean {
    return node.parentId === null || this.sceneExpandedNodes.has(node.id);
  }

  toggleSceneNodeExpanded(node: SceneOutlineNode): void {
    if (node.parentId === null) {
      return;
    }

    if (this.sceneExpandedNodes.has(node.id)) {
      this.sceneExpandedNodes.delete(node.id);
    } else {
      this.sceneExpandedNodes.add(node.id);
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

  onSceneNodeContextMenu(event: MouseEvent, node: SceneOutlineNode): void {
    if (!isPlatformBrowser(this.platformId) || !this.isSceneNodeSelectable(node)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.sceneService.selectDecorationById(node.id);
    this.sceneSelectedNodeId = node.id;
    this.openContextMenuAt(event.clientX, event.clientY);
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

  changeSceneTreeScale(delta: number): void {
    this.sceneTreeScale = Math.min(1.3, Math.max(0.9, this.sceneTreeScale + delta));
  }

  selectSetupTab(tab: 'cake' | 'texture' | 'color' | 'glaze'): void {
    this.setupTab = tab;
  }

  selectCakeSize(size: 'small' | 'medium' | 'large'): void {
    if (this.setupLocked) {
      return;
    }
    this.selectedCakeSize = size;
    this.applyLayerSizing(this.selectedLayers, this.getBaseWidth(size));
  }

  selectShape(shape: 'cylinder' | 'cuboid'): void {
    if (this.setupLocked) {
      return;
    }
    this.selectedShape = shape;
    this.patchOptions({ shape });
    this.syncWaferMaskToShape(true);
  }

  selectLayers(layers: number): void {
    if (this.setupLocked) {
      return;
    }
    this.selectedLayers = layers;
    this.applyLayerSizing(layers, this.getBaseWidth());
  }

  selectTexture(target: 'cake' | 'glaze', textureId: string): void {
    const options = target === 'cake' ? this.cakeTextureOptions : this.glazeTextureOptions;
    const match = options.find((t) => t.id === textureId);

    if (!match) {
      return;
    }

    if (target === 'cake') {
      this.selectedCakeTextureId = textureId;
      this.gradientEnabled = false;
      this.textureBeforeGradient = null;
      const cakeColor = match.isCustomColorizable ? this.primaryColor : '#ffffff';
      this.patchOptions({
        cake_textures: { ...match.maps },
        cake_color: cakeColor,
      });
      this.syncGradientDisabledState();
      return;
    }

    this.selectedGlazeTextureId = textureId;
    this.glazeEnabled = true;
    this.patchOptions({
      glaze_enabled: true,
      glaze_textures: { ...match.maps },
    });
  }

  getInputValue(event: Event): string {
    const target = event.target as HTMLInputElement | null;
    return target?.value ?? '';
  }

  setCakeColor(color: string): void {
    if (!this.cakeColorEditable) {
      return;
    }
    this.primaryColor = color;
    this.gradientEnabled = false;
    this.selectedCakeTextureId = null;
    this.textureBeforeGradient = null;
    this.patchOptions({ cake_color: color, cake_textures: null });
    this.syncGradientDisabledState();
  }

  setGradientColor(which: 'first' | 'second', color: string): void {
    if (!this.cakeColorEditable) {
      return;
    }
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
    if (!this.cakeColorEditable) {
      this.gradientEnabled = false;
      this.syncGradientDisabledState();
      return;
    }
    this.gradientEnabled = enabled;
    if (enabled) {
      this.textureBeforeGradient = this.options.cake_textures ?? null;
      this.applyGradientTexture();
    } else {
      this.applyGradientTexture();
    }
  }

  setGradientDirection(direction: 'top-bottom' | 'bottom-top'): void {
    if (!this.cakeColorEditable) {
      return;
    }
    this.gradientDirection = direction;
    if (this.gradientEnabled) {
      this.applyGradientTexture();
    }
  }

  toggleGlaze(enabled: boolean): void {
    if (this.setupLocked) {
      return;
    }
    this.glazeEnabled = enabled;
    this.patchOptions({ glaze_enabled: enabled });
  }

  setGlazeMode(mode: 'taffla' | 'plain'): void {
    if (this.setupLocked) {
      return;
    }
    this.glazeMode = mode;
    this.patchOptions({ glaze_top_enabled: mode === 'taffla' });
  }

  setGlazeColor(color: string): void {
    if (!this.glazeColorEditable) {
      return;
    }
    const selectedGlaze = this.selectedGlazeTextureId
      ? this.glazeTextureOptions.find((option) => option.id === this.selectedGlazeTextureId)
      : null;

    const shouldPreserveTexture =
      !!selectedGlaze && this.isCustomTexture(selectedGlaze.id, 'glaze') && !!selectedGlaze.maps;

    if (!shouldPreserveTexture) {
      this.selectedGlazeTextureId = null;
    }

    this.glazeEnabled = true;
    this.patchOptions({
      glaze_enabled: true,
      glaze_color: color,
      glaze_textures: shouldPreserveTexture ? { ...selectedGlaze!.maps } : null,
    });
  }

  toggleWafer(enabled: boolean): void {
    if (this.setupLocked) {
      return;
    }
    this.waferEnabled = enabled;
    this.syncWaferMaskToShape(false);
    const fallback = this.options.wafer_texture_url ?? '/assets/textures/Pink%20Candy_BaseColor.jpg';
    this.patchOptions({
      wafer_texture_url: enabled ? fallback : null,
      wafer_mask: this.waferMask,
      wafer_perspective: this.waferPerspective,
      wafer_scale: this.waferScale,
      wafer_texture_zoom: this.waferZoom,
      wafer_texture_offset_x: this.waferOffsetX,
      wafer_texture_offset_y: this.waferOffsetY,
    });
    if (!enabled) {
      this.waferScale = 1;
      this.waferZoom = 1;
      this.waferOffsetX = 0;
      this.waferOffsetY = 0;
      this.waferPerspective = 0;
      this.syncWaferMaskToShape(false);
      this.waferLoadError = null;
      this.loadWaferImage(null);
    } else {
      this.loadWaferImage(fallback);
    }
    this.scheduleWaferPreviewRender();
  }

  setWaferColor(color: string): void {
    if (this.waferEnabled) {
      this.patchOptions({ glaze_color: color });
    }
  }

  setWaferScale(scale: number): void {
    if (this.setupLocked) {
      return;
    }
    this.waferScale = scale;
    this.scheduleWaferPreviewRender();
  }

  setWaferZoom(zoom: number): void {
    if (this.setupLocked) {
      return;
    }
    this.waferZoom = zoom;
    this.scheduleWaferPreviewRender();
  }

  setWaferOffset(axis: 'x' | 'y', value: number): void {
    if (this.setupLocked) {
      return;
    }
    if (axis === 'x') {
      this.waferOffsetX = value;
    } else {
      this.waferOffsetY = value;
    }
    this.scheduleWaferPreviewRender();
  }

  setWaferMask(_mask: 'circle' | 'square'): void {
    if (this.setupLocked) {
      return;
    }
    this.syncWaferMaskToShape(true);
    this.scheduleWaferPreviewRender();
  }

  setWaferPerspective(value: number): void {
    if (this.setupLocked) {
      return;
    }
    this.waferPerspective = value;
    this.scheduleWaferPreviewRender();
  }

  resetWaferTransform(): void {
    this.setWaferZoom(1);
    this.setWaferOffset('x', 0);
    this.setWaferOffset('y', 0);
    this.setWaferPerspective(0);
    this.syncWaferMaskToShape(true);
  }

  get waferHasPendingChanges(): boolean {
    if (!this.waferEnabled) {
      return false;
    }

    return (
      (this.options.wafer_scale ?? 1) !== this.waferScale ||
      (this.options.wafer_texture_zoom ?? 1) !== this.waferZoom ||
      (this.options.wafer_texture_offset_x ?? 0) !== this.waferOffsetX ||
      (this.options.wafer_texture_offset_y ?? 0) !== this.waferOffsetY ||
      (this.options.wafer_perspective ?? 0) !== this.waferPerspective ||
      (this.options.wafer_mask ?? this.getMaskForShape(this.selectedShape)) !== this.waferMask
    );
  }

  applyWaferSettings(showStatus = true): void {
    if (!this.waferEnabled) {
      return;
    }

    this.patchOptions({
      wafer_scale: this.waferScale,
      wafer_texture_zoom: this.waferZoom,
      wafer_texture_offset_x: this.waferOffsetX,
      wafer_texture_offset_y: this.waferOffsetY,
      wafer_mask: this.waferMask,
      wafer_perspective: this.waferPerspective,
    });

    if (showStatus) {
      this.showStatus('Zastosowano ustawienia opłatka.');
    }
  }

  onWaferPointerDown(event: PointerEvent): void {
    if (!this.waferEnabled || this.setupLocked) {
      return;
    }
    const canvas = this.waferCanvas?.nativeElement;
    if (!canvas) return;

    this.waferDragStart = {
      x: event.clientX,
      y: event.clientY,
      offsetX: this.waferOffsetX,
      offsetY: this.waferOffsetY,
    };
    canvas.setPointerCapture?.(event.pointerId);
  }

  onWaferPointerMove(event: PointerEvent): void {
    if (!this.waferDragStart || !this.waferEnabled || this.setupLocked) {
      return;
    }

    const canvas = this.waferCanvas?.nativeElement;
    if (!canvas) return;

    const maskSize = this.getWaferMaskSize(canvas);
    if (!maskSize) return;

    const deltaX = event.clientX - this.waferDragStart.x;
    const deltaY = event.clientY - this.waferDragStart.y;

    const normalizedFactor = 2 / maskSize;
    const nextX = this.waferDragStart.offsetX + deltaX * normalizedFactor;
    const nextY = this.waferDragStart.offsetY - deltaY * normalizedFactor;

    this.setWaferOffset('x', THREE.MathUtils.clamp(nextX, -1, 1));
    this.setWaferOffset('y', THREE.MathUtils.clamp(nextY, -1, 1));
  }

  onWaferPointerUp(): void {
    this.waferDragStart = null;
  }

  onWaferWheel(event: WheelEvent): void {
    if (!this.waferEnabled || this.setupLocked) {
      return;
    }
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.05 : -0.05;
    const nextZoom = THREE.MathUtils.clamp(this.waferZoom + delta, 0.5, 3);
    this.setWaferZoom(nextZoom);
  }

  private scheduleWaferPreviewRender(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (this.waferPreviewFrame !== null) {
      cancelAnimationFrame(this.waferPreviewFrame);
    }

    this.waferPreviewFrame = window.requestAnimationFrame(() => {
      this.waferPreviewFrame = null;
      this.renderWaferPreview();
    });
  }

  private loadWaferImage(url: string | null): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (!url) {
      this.waferImage = null;
      this.scheduleWaferPreviewRender();
      return;
    }

    const image = new Image();
    image.onload = () => {
      this.waferImage = image;
      this.scheduleWaferPreviewRender();
    };
    image.onerror = () => {
      this.waferLoadError = 'Nie udało się wczytać obrazu opłatka.';
      this.waferImage = null;
      this.scheduleWaferPreviewRender();
    };
    image.src = url;
  }

  private renderWaferPreview(): void {
    const canvas = this.waferCanvas?.nativeElement;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const width = canvas.clientWidth || 240;
    const height = canvas.clientHeight || 240;
    canvas.width = width;
    canvas.height = height;

    context.clearRect(0, 0, width, height);

    const maskSize = this.getWaferMaskSize(canvas);
    const maskRadius = maskSize / 2;
    const maskPath = new Path2D();
    const centerX = width / 2;
    const centerY = height / 2;

    if (this.waferMask === 'circle') {
      maskPath.arc(centerX, centerY, maskRadius, 0, Math.PI * 2);
    } else {
      maskPath.rect(centerX - maskRadius, centerY - maskRadius, maskSize, maskSize);
    }

    context.save();
    context.clip(maskPath);

    if (this.waferImage) {
      context.save();
      context.translate(centerX, centerY);
      const shear = this.waferPerspective / 80;
      context.transform(1, 0, shear, 1, 0, 0);

      const offsetX = this.waferOffsetX * maskRadius;
      const offsetY = -this.waferOffsetY * maskRadius;

      const drawWidth = this.waferImage.width * this.waferZoom;
      const drawHeight = this.waferImage.height * this.waferZoom;

      context.drawImage(
        this.waferImage,
        -drawWidth / 2 + offsetX,
        -drawHeight / 2 + offsetY,
        drawWidth,
        drawHeight,
      );
      context.restore();
    } else {
      context.fillStyle = '#f7f7f7';
      context.fillRect(centerX - maskRadius, centerY - maskRadius, maskSize, maskSize);
      context.fillStyle = '#c2c2c2';
      context.textAlign = 'center';
      context.font = '14px sans-serif';
      context.fillText('Brak podglądu', centerX, centerY + 5);
    }

    context.restore();

    context.save();
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'destination-out';
    context.fill(maskPath);
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    context.lineWidth = 2;
    context.stroke(maskPath);
    context.restore();
  }

  private getWaferMaskSize(canvas: HTMLCanvasElement): number {
    const size = Math.min(canvas.clientWidth || 0, canvas.clientHeight || 0);
    return size > 0 ? size * 0.9 : 0;
  }

  private getBaseWidth(size: 'small' | 'medium' | 'large' = this.selectedCakeSize): number {
    if (size === 'small') return 0.9;
    if (size === 'large') return 1.2;
    return 1;
  }

  private getMaskForShape(shape: 'cylinder' | 'cuboid'): 'circle' | 'square' {
    return shape === 'cylinder' ? 'circle' : 'square';
  }

  private syncWaferMaskToShape(applyToOptions: boolean): void {
    const expectedMask = this.getMaskForShape(this.selectedShape);
    if (this.waferMask !== expectedMask) {
      this.waferMask = expectedMask;
      this.scheduleWaferPreviewRender();
    }

    if (applyToOptions && this.waferEnabled && this.options.wafer_mask !== expectedMask) {
      this.applyWaferSettings(false);
    }
  }

  private applyLayerSizing(layers: number, baseWidth: number): void {
    const widenedBase = baseWidth + (layers - 1) * 0.2;
    const sizes = Array.from({ length: layers }, (_, idx) => Math.max(0.6, widenedBase - idx * 0.2));
    this.patchOptions({ layers, layerSizes: sizes, cake_size: 1 });
  }

  onWaferFileSelected(event: Event): void {
    if (this.setupLocked) {
      return;
    }
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.waferLoadError = 'Obsługiwane są wyłącznie pliki graficzne.';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      this.waferLoadError = null;
      this.patchOptions({ wafer_texture_url: result });
      this.loadWaferImage(result);
      this.scheduleWaferPreviewRender();
    };
    reader.onerror = () => {
      this.waferLoadError = 'Nie udało się wczytać wybranego pliku.';
    };
    reader.readAsDataURL(file);
  }

  openDecorPanel(): void {
    this.updateActiveSidebarPanel('decorations');
    this.sidebar?.focusPanel('decorations');
    this.closeExportPopup();
  }

  openPaintPanel(mode: SidebarPaintMode = this.paintingMode): void {
    this.paintingMode = mode;
    this.updateActiveSidebarPanel('paint');
    this.sidebar?.focusPanel('paint');
    this.closeExportPopup();
  }

  openPresetPanel(): void {
    this.updateActiveSidebarPanel('presets');
    this.sidebar?.focusPanel('presets');
    this.closeExportPopup();
  }

  openAdminPanel(): void {
    if (!this.isAdmin) {
      return;
    }
    this.updateActiveSidebarPanel('admin');
    this.sidebar?.focusPanel('admin');
    this.closeExportPopup();
  }

  onSidebarPanelChange(panel: SidebarPanelKey): void {
    this.updateActiveSidebarPanel(panel);
  }

  toggleExportPopup(): void {
    this.exportPopupOpen = !this.exportPopupOpen;
  }

  closeExportPopup(): void {
    this.exportPopupOpen = false;
  }

  onSidebarPaintModeChange(mode: SidebarPaintMode): void {
    this.paintingMode = mode;
    const usesSurfacePainting = mode === 'brush' || mode === 'sprinkles';
    const powerEnabled = this.paintingPowerEnabled;
    this.surfacePaintingService.enabled = usesSurfacePainting && powerEnabled;

    if (usesSurfacePainting) {
      this.surfacePaintingService.mode = mode === 'brush' ? 'brush' : 'sprinkles';
      this.onTogglePaintMode(false);
      return;
    }

    this.surfacePaintingService.enabled = false;
    const tool = mode === 'extruder' ? 'extruder' : mode === 'decor3d' ? 'decoration' : 'pen';
    this.paintService.setPaintTool(tool as 'decoration' | 'pen' | 'extruder');
    this.onTogglePaintMode(powerEnabled);
  }

  onSidebarBrushChange(settings: BrushSettings): void {
    if (settings.brushId) {
      this.paintBrushId = settings.brushId;
      if (this.paintingMode === 'extruder') {
        this.paintService.setExtruderBrush(settings.brushId);
      } else {
        this.paintService.setCurrentBrush(settings.brushId);
      }
    }

    if (settings.color || settings.size !== undefined || settings.thickness !== undefined || settings.opacity !== undefined) {
      this.paintColor = settings.color ?? this.paintColor;
      this.penSize = settings.size ?? this.penSize;
      this.penThickness = settings.thickness ?? this.penThickness;
      this.paintService.updatePenSettings({
        size: settings.size,
        thickness: settings.thickness,
        color: settings.color,
        opacity: settings.opacity,
      });
    }
  }

  onPaintingPowerChange(enabled: boolean): void {
    this.paintingPowerEnabled = enabled;
    const usesSurfacePainting = this.paintingMode === 'brush' || this.paintingMode === 'sprinkles';
    this.surfacePaintingService.enabled = enabled && usesSurfacePainting;
    this.paintService.paintMode = enabled && !usesSurfacePainting;
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

  private updateActiveSidebarPanel(panel: SidebarPanelKey): void {
    const previousPanel = this.activeSidebarPanel;

    if (previousPanel !== panel) {
      this.handlePanelExit(previousPanel, panel);
      this.activeSidebarPanel = panel;
    }

    this.handlePanelEntry(panel);
  }

  private handlePanelExit(previousPanel: SidebarPanelKey, nextPanel: SidebarPanelKey): void {
    if (previousPanel === 'paint' && nextPanel !== 'paint') {
      this.onPaintingPowerChange(false);
      this.paintingPowerEnabled = false;
    }

    if (previousPanel === 'decorations' && nextPanel !== 'decorations') {
      this.anchorPresetsService.setPendingDecoration(null);
      this.anchorPresetsService.setMarkersVisible(false);
      this.anchorPresetsService.setFocusedAnchor(null);
      this.anchorPresetsService.setRecordingOptions(false);
    }

    if (previousPanel === 'admin' && nextPanel !== 'admin') {
      this.anchorPresetsService.setMarkersVisible(false);
      this.anchorPresetsService.setFocusedAnchor(null);
      this.anchorPresetsService.setPendingDecoration(null);
      this.anchorPresetsService.setRecordingOptions(false);
      this.sceneService.clearAnchorPreviews();
    }
  }

  private handlePanelEntry(panel: SidebarPanelKey): void {
    if (panel === 'paint') {
      const desiredPower = true;
      this.paintingPowerEnabled = desiredPower;
      this.onSidebarPaintModeChange(this.paintingMode);
      this.onPaintingPowerChange(desiredPower);
      return;
    }

    if (panel === 'decorations') {
      this.paintingPowerEnabled = false;
      this.surfacePaintingService.enabled = false;
      this.paintService.paintMode = false;
      this.onSidebarPaintModeChange('decor3d');
      this.anchorPresetsService.setFocusedAnchor(null);
      this.anchorPresetsService.setRecordingOptions(false);
      return;
    }

    if (panel === 'admin') {
      this.anchorPresetsService.setMarkersVisible(true);
      this.anchorPresetsService.setFocusedAnchor(null);
      this.anchorPresetsService.setPendingDecoration(null);
      this.anchorPresetsService.setRecordingOptions(false);
      return;
    }
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
      next: () => {
        this.showStatus('Projekt zapisany.');
        void this.refreshProjectThumbnail(this.currentProjectId!);
      },
      error: () => this.showStatus('Nie udało się zapisać projektu.'),
    });
  }

  private async refreshProjectThumbnail(projectId: number): Promise<void> {
    try {
      const blob = await this.sceneService.generateCakeThumbnailBlob();
      const response = await lastValueFrom(this.projectsService.uploadThumbnail(projectId, blob));
      if (response?.thumbnailUrl) {
        this.currentProjectThumbnailUrl = response.thumbnailUrl;
      }
    } catch (error) {
      console.warn('Failed to refresh thumbnail', error);
    }
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

  onFocusButtonClick(): void {
    const result = this.sceneService.frameSelectionOrCake();
    this.showStatus(result.message);
  }

  onFocusButtonDoubleClick(): void {
    this.sceneService.resetOrbitPivot();
    this.showStatus('Środek obrotu ustawiony na tort.');
  }

  onToggleSceneBackground(): void {
    this.sceneBackground = this.sceneService.toggleBackgroundMode();
  }

  onBack(): void {
    if (this.mode === 'workspace') {
      this.mode = 'setup';
      this.exportPopupOpen = false;
      this.helperMenuOpen = false;
      this.cameraDropdownOpen = false;
      this.sceneService.requestRender();
      return;
    }

    this.goToProjects();
  }

  onToolbarUndo(): void {
    if (!this.canUndoAction) {
      return;
    }

    this.paintService.undo();
    this.refreshUndoRedoAvailability();
  }

  onToolbarRedo(): void {
    if (!this.canRedoAction) {
      return;
    }

    this.paintService.redo();
    this.refreshUndoRedoAvailability();
  }

  private refreshUndoRedoAvailability(): void {
    this.canUndoAction = this.paintService.canUndo();
    this.canRedoAction = this.paintService.canRedo();
    this.changeDetectorRef.detectChanges();
  }

  private updateSetupLockState(): void {
    if (!this.sceneInitialized) {
      this.setupLocked = false;
      return;
    }

    this.setupLocked = this.sceneService.hasDecorationsOrPaint();
  }

  private async handleAnchorClick(anchorId: string): Promise<void> {
    const pendingDecoration = this.anchorPresetsService.getPendingDecoration();
    if (!pendingDecoration) {
      this.showStatus('Wybierz dekorację, aby dodać ją na kotwicy.');
      return;
    }

    const result = await this.sceneService.spawnDecorationAtAnchor(
      pendingDecoration.modelFileName,
      anchorId,
      { replaceExisting: !this.isAdmin },
    );
    if (result.success) {
      if (this.anchorPresetsService.isRecordingOptions()) {
        const added = this.anchorPresetsService.appendAllowedDecoration(
          anchorId,
          pendingDecoration.modelFileName ?? pendingDecoration.id,
        );
        if (added) {
          this.sceneService.markAnchorOptionAddition(
            anchorId,
            pendingDecoration.modelFileName ?? pendingDecoration.id,
          );
        }
      }
      this.anchorPresetsService.setPendingDecoration(null);
      this.anchorPresetsService.setFocusedAnchor(null);
    }
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

    this.closeExportPopup();
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
    this.showStatus('Wykryto problemy z dekoracjami – sprawdź szczegóły w eksporcie.');
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
    if (this.rightClickDrag?.moved) {
      this.rightClickDrag = undefined;
      return;
    }
    const orbitBusy = this.sceneService.isOrbitBusy();
    const paintBusy = this.paintService.paintMode && this.paintService.isPainting;
    if ((orbitBusy && (!this.rightClickDrag || this.rightClickDrag.moved)) || paintBusy) {
      this.hideContextMenu();
      return;
    }
    this.hideContextMenu();

    this.sceneService.selectDecorationAt(event.clientX, event.clientY);
    this.openContextMenuAt(event.clientX, event.clientY);
  }

  private rebindCanvasListeners(target?: HTMLElement): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const nextTarget = target ?? (this.container?.nativeElement as HTMLElement | undefined);
    if (this.canvasListenerTarget === nextTarget) {
      return;
    }

    this.teardownCanvasListeners();
    if (!nextTarget) {
      return;
    }

    nextTarget.addEventListener('pointerdown', this.handlePointerDown, { passive: true });
    nextTarget.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    nextTarget.addEventListener('pointerup', this.handlePointerUp);
    nextTarget.addEventListener('contextmenu', this.contextMenuListener);
    this.canvasListenerTarget = nextTarget;
  }

  private teardownCanvasListeners(): void {
    if (!this.canvasListenerTarget) {
      return;
    }

    this.canvasListenerTarget.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvasListenerTarget.removeEventListener('pointermove', this.handlePointerMove);
    this.canvasListenerTarget.removeEventListener('pointerup', this.handlePointerUp);
    this.canvasListenerTarget.removeEventListener('contextmenu', this.contextMenuListener);
    this.canvasListenerTarget = undefined;
  }

  private openContextMenuAt(x: number, y: number): void {
    const selected = this.sceneService.getSelectedDecoration();
    const isSnapped = this.sceneService.isSelectedDecorationSnapped();
    this.contextMenuHasSelection = !!selected;
    this.contextMenuCanSnap = !!selected && !isSnapped;
    this.contextMenuIsLocked = !!selected && this.sceneService.isSelectedDecorationLocked();

    this.contextMenuVisible = true;
    if (isPlatformBrowser(this.platformId)) {
      const viewportWidth = window.innerWidth || 0;
      const viewportHeight = window.innerHeight || 0;
      const menuWidth = 240;
      const menuHeight = 420;
      const margin = 8;
      const safeX = Math.max(margin, Math.min(x, viewportWidth - menuWidth - margin));
      const safeY = Math.max(margin, Math.min(y, viewportHeight - menuHeight - margin));
      this.contextMenuX = safeX;
      this.contextMenuY = safeY;
    } else {
      this.contextMenuX = x;
      this.contextMenuY = y;
    }
  }

  private hideContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextMenuHasSelection = false;
    this.contextMenuCanSnap = false;
    this.contextMenuIsLocked = false;
    this.rightClickDrag = undefined;
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
    this.surfacePaintingService.updateGradientTexture({
      enabled: this.gradientEnabled,
      startColor: this.gradientFirst,
      endColor: this.gradientSecond,
      flip: this.gradientDirection === 'bottom-top',
    });

    if (!this.gradientEnabled) {
      this.patchOptions({ cake_color: this.primaryColor, cake_textures: this.textureBeforeGradient });
    }
  }

  private syncGradientDisabledState(): void {
    this.surfacePaintingService.updateGradientTexture({
      enabled: false,
      startColor: this.gradientFirst,
      endColor: this.gradientSecond,
      flip: this.gradientDirection === 'bottom-top',
    });
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
    this.waferMask = this.getMaskForShape(this.selectedShape);
    this.waferPerspective = this.options.wafer_perspective ?? 0;
    this.syncWaferMaskToShape(this.waferEnabled);
    this.loadWaferImage(this.options.wafer_texture_url);
    this.scheduleWaferPreviewRender();
    this.syncSelectedTextures();
  }

  private shouldHandleResetShortcut(event: KeyboardEvent): boolean {
    if (event.key.toLowerCase() !== 'r' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return false;
    }

    return this.isShortcutAllowedTarget(event);
  }

  private shouldHandleFocusShortcut(event: KeyboardEvent): boolean {
    if (event.key.toLowerCase() !== 'f' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return false;
    }

    return this.isShortcutAllowedTarget(event);
  }

  private isShortcutAllowedTarget(event: KeyboardEvent): boolean {
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
