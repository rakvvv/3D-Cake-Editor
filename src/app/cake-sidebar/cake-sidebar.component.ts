import { Component, Input, OnInit, output } from '@angular/core';
import { DecorationsService } from '../services/decorations.service';
import { PaintService } from '../services/paint.service';
import { CakeOptions } from '../models/cake.options';
import { LayersPanelComponent } from './layers-panel/layers-panel.component';
import { DecorationsPanelComponent } from './decorations-panel/decorations-panel.component';
import { PaintPanelComponent } from './paint-panel/paint-panel.component';
import { ExportPanelComponent } from './export-panel/export-panel.component';
import { SceneOutlineComponent } from './scene-outline/scene-outline.component';
import { DecorationValidationIssue } from '../models/decoration-validation';
import { ThreeSceneService } from '../services/three-scene.service';
type SidebarPanelKey = 'layers' | 'decorations' | 'outline' | 'paint' | 'export';

@Component({
  selector: 'app-cake-sidebar',
  standalone: true,
  imports: [
    LayersPanelComponent,
    DecorationsPanelComponent,
    SceneOutlineComponent,
    PaintPanelComponent,
    ExportPanelComponent,
  ],
  templateUrl: './cake-sidebar.component.html',
  styleUrls: ['./cake-sidebar.component.css']
})
export class CakeSidebarComponent implements OnInit {
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] = [];
  @Input() pendingValidationLabel: string | null = null;

  readonly addDecorationEvent = output<string>();
  readonly saveSceneEvent = output<void>();
  readonly validateDecorations = output<void>();
  readonly cakeOptionsChange = output<CakeOptions>();
  readonly transformModeChange = output<'translate' | 'rotate' | 'scale'>();
  readonly paintModeChange = output<boolean>();
  readonly brushChange = output<string>();
  readonly exportObj = output<void>();
  readonly exportStl = output<void>();
  readonly exportGltf = output<void>();
  readonly screenshot = output<void>();
  readonly proceedDespiteWarnings = output<void>();

  private openPanels = new Set<SidebarPanelKey>(['layers']);

  togglePanel(panel: SidebarPanelKey): void {
    if (this.openPanels.has(panel)) {
      this.openPanels.delete(panel);
    } else {
      this.openPanels.add(panel);
    }
  }

  isExpanded(panel: SidebarPanelKey): boolean {
    return this.openPanels.has(panel);
  }

  panelToggleId(panel: SidebarPanelKey): string {
    return `sidebar-toggle-${panel}`;
  }

  panelRegionId(panel: SidebarPanelKey): string {
    return `sidebar-panel-${panel}`;
  }

  constructor(
    public readonly decorationsService: DecorationsService,
    public readonly paintService: PaintService,
    private readonly sceneService: ThreeSceneService,
  ) {}

  ngOnInit(): void {
    void this.sceneService.loadDecorationsData();
  }
}
