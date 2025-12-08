import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CakeOptions } from '../../models/cake.options';
import { AddDecorationRequest } from '../../models/add-decoration-request';
import { DecoratedCakePreset } from '../../models/cake-preset';
import { CakePresetsService } from '../../services/cake-presets.service';
import { ThreeSceneService } from '../../services/three-scene.service';
import { SidebarDecorationsPanelComponent } from './panels/sidebar-decorations-panel.component';
import { SidebarPaintPanelComponent } from './panels/sidebar-paint-panel.component';
import { SidebarPresetsPanelComponent } from './panels/sidebar-presets-panel.component';
import { BrushSettings, SidebarPanelKey, SidebarPaintMode } from './sidebar.types';

@Component({
  selector: 'app-editor-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SidebarDecorationsPanelComponent,
    SidebarPresetsPanelComponent,
    SidebarPaintPanelComponent,
  ],
  templateUrl: './editor-sidebar.component.html',
  styleUrls: ['./editor-sidebar.component.css'],
})
export class EditorSidebarComponent implements OnInit, OnDestroy {
  @Input() options!: CakeOptions;
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
  @Output() saveScene = new EventEmitter<void>();
  @Output() applyCakePreset = new EventEmitter<DecoratedCakePreset>();
  @Output() brushChange = new EventEmitter<BrushSettings>();
  @Output() paintModeChange = new EventEmitter<SidebarPaintMode>();
  @Output() panelChange = new EventEmitter<SidebarPanelKey>();
  @Output() paintingPowerChange = new EventEmitter<boolean>();

  activePanel: SidebarPanelKey = 'decorations';
  presets: DecoratedCakePreset[] = [];
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
