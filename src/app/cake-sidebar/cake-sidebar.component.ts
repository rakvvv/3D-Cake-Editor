import { Component, ElementRef, Input, ViewChild, output } from '@angular/core';
import { DecorationsService } from '../services/decorations.service';
import { PaintService } from '../services/paint.service';
import { CakeOptions } from '../models/cake.options';
import { LayersPanelComponent } from './layers-panel/layers-panel.component';
import { DecorationsPanelComponent } from './decorations-panel/decorations-panel.component';
import { PaintPanelComponent } from './paint-panel/paint-panel.component';
import { ExportPanelComponent } from './export-panel/export-panel.component';
import { DecorationValidationIssue } from '../models/decoration-validation';

@Component({
  selector: 'app-cake-sidebar',
  standalone: true,
  imports: [LayersPanelComponent, DecorationsPanelComponent, PaintPanelComponent, ExportPanelComponent],
  templateUrl: './cake-sidebar.component.html',
  styleUrls: ['./cake-sidebar.component.css']
})
export class CakeSidebarComponent {
  @Input() validationSummary: string | null = null;
  @Input() validationIssues: DecorationValidationIssue[] = [];
  @Input() pendingValidationLabel: string | null = null;

  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLElement>;
  @ViewChild('layersPanel', { read: ElementRef }) private layersPanel?: ElementRef<HTMLElement>;
  @ViewChild('decorationsPanel', { read: ElementRef }) private decorationsPanel?: ElementRef<HTMLElement>;
  @ViewChild('paintPanel', { read: ElementRef }) private paintPanel?: ElementRef<HTMLElement>;
  @ViewChild('exportPanel', { read: ElementRef }) private exportPanel?: ElementRef<HTMLElement>;

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

  constructor(
    public readonly decorationsService: DecorationsService,
    public readonly paintService: PaintService,
  ) {}

  scrollToPanel(panel: 'layers' | 'decorations' | 'paint' | 'export'): void {
    const target =
      panel === 'layers'
        ? this.layersPanel
        : panel === 'decorations'
        ? this.decorationsPanel
        : panel === 'paint'
        ? this.paintPanel
        : this.exportPanel;

    if (!target?.nativeElement) {
      return;
    }

    target.nativeElement.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });

    if (this.scrollContainer?.nativeElement) {
      this.scrollContainer.nativeElement.focus({ preventScroll: true });
    }
  }
}
