import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CakeOptions } from '../../models/cake.options';
import { DecorationValidationIssue } from '../../models/decoration-validation';
import { AddDecorationRequest } from '../../models/add-decoration-request';
import { DecoratedCakePreset } from '../../models/cake-preset';
import { CakePresetsService } from '../../services/cake-presets.service';
import { ThreeSceneService } from '../../services/three-scene.service';
import { SidebarDecorationsPanelComponent } from './panels/sidebar-decorations-panel.component';
import { SidebarExportPanelComponent } from './panels/sidebar-export-panel.component';
import { SidebarLayersPanelComponent } from './panels/sidebar-layers-panel.component';
import { SidebarPaintPanelComponent } from './panels/sidebar-paint-panel.component';
import { SidebarPresetsPanelComponent } from './panels/sidebar-presets-panel.component';
import { SidebarTexturesPanelComponent } from './panels/sidebar-textures-panel.component';
import { BrushSettings, SidebarPanelKey, SidebarPaintMode, SidebarTextureOption } from './sidebar.types';
import { TextureMaps } from '../../models/cake.options';

@Component({
  selector: 'app-editor-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SidebarLayersPanelComponent,
    SidebarTexturesPanelComponent,
    SidebarDecorationsPanelComponent,
    SidebarPresetsPanelComponent,
    SidebarPaintPanelComponent,
    SidebarExportPanelComponent,
  ],
  templateUrl: './editor-sidebar.component.html',
  styleUrls: ['./editor-sidebar.component.css'],
})
export class EditorSidebarComponent implements OnInit, OnDestroy {
  @Input() options!: CakeOptions;
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] | null = null;
  @Input() pendingValidationLabel: string | null = null;
  @Input() authorModeEnabled = false;
  @Input() paintingMode: SidebarPaintMode = 'decor3d';
  @Input() paintColor = '#ff4d6d';
  @Input() penSize = 0.05;
  @Input() penThickness = 0.02;
  @Input() penOpacity = 1;
  @Input() paintBrushId = 'trawa.glb';
  @Input() paintingPowerEnabled = true;

  @Output() optionsChange = new EventEmitter<CakeOptions>();
  @Output() addDecoration = new EventEmitter<AddDecorationRequest>();
  @Output() validateDecorations = new EventEmitter<void>();
  @Output() saveScene = new EventEmitter<void>();
  @Output() applyCakePreset = new EventEmitter<DecoratedCakePreset>();
  @Output() proceedDespiteWarnings = new EventEmitter<void>();
  @Output() exportObj = new EventEmitter<void>();
  @Output() exportStl = new EventEmitter<void>();
  @Output() exportGltf = new EventEmitter<void>();
  @Output() brushChange = new EventEmitter<BrushSettings>();
  @Output() paintModeChange = new EventEmitter<SidebarPaintMode>();
  @Output() panelChange = new EventEmitter<SidebarPanelKey>();
  @Output() paintingPowerChange = new EventEmitter<boolean>();

  activePanel: SidebarPanelKey = 'decorations';
  presets: DecoratedCakePreset[] = [];
  readonly textureOptions: SidebarTextureOption[] = [
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

  private subscriptions = new Subscription();

  constructor(
    private readonly sceneService: ThreeSceneService,
    private readonly cakePresetsService: CakePresetsService,
  ) {}

  ngOnInit(): void {
    void this.sceneService.loadDecorationsData();
    void this.cakePresetsService.loadPresets();

    this.subscriptions.add(this.cakePresetsService.presets$.subscribe((presets) => (this.presets = presets)));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  focusPanel(panel: SidebarPanelKey): void {
    this.activePanel = panel;
    this.panelChange.emit(panel);
  }

  onPanelSelect(panel: SidebarPanelKey): void {
    this.focusPanel(panel);
  }

  onOptionsChange(options: CakeOptions): void {
    this.optionsChange.emit(options);
  }

  onAddDecoration(request: AddDecorationRequest): void {
    this.addDecoration.emit(request);
  }

  onPresetApply(preset: DecoratedCakePreset): void {
    this.applyCakePreset.emit(preset);
  }

  onPaintModeChange(mode: SidebarPaintMode): void {
    this.paintModeChange.emit(mode);
    this.focusPanel('paint');
  }

  onBrushChange(settings: BrushSettings): void {
    this.brushChange.emit(settings);
  }
}
