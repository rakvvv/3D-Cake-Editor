import {Component, AfterViewInit, ViewChild, ElementRef, Inject, PLATFORM_ID} from '@angular/core';
import {CommonModule, isPlatformBrowser} from '@angular/common';
import {CakeSidebarComponent} from '../cake-sidebar/cake-sidebar.component';
import {ThreeSceneService} from '../services/three-scene.service';
import {DecorationsService} from '../services/decorations.service';
import {PaintService} from '../services/paint.service';
import { TransformControlsService } from '../services/transform-controls-service';
import {CakeOptions} from '../models/cake.options';

@Component({
  selector: 'app-cake-editor',
  standalone: true,
  imports: [CommonModule, CakeSidebarComponent],
  templateUrl: './cake-editor.component.html',
  styleUrls: ['./cake-editor.component.css']
})
export class CakeEditorComponent implements AfterViewInit {
  @ViewChild('canvasContainer') container!: ElementRef;

  public options: CakeOptions = {
    cake_size: 1,
    cake_color: '#ffea00',
    cake_text: false,
    cake_text_value: 'Urodziny'
  };

  constructor(
    public sceneService: ThreeSceneService,
    private transformService: TransformControlsService,
    private decorationsService: DecorationsService,
    private paintService: PaintService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngAfterViewInit(): void {
    this.initializeScene();
  }

  onAddDecoration(templateId: string): void {
    this.decorationsService.addDecorationFromModel(
      templateId,
      this.sceneService.scene,
      this.sceneService.cakeBase,
      this.sceneService.objects
    );
  }

  updateCakeOptions(newOptions: CakeOptions): void {
    this.options = newOptions;
    this.sceneService.updateCakeOptions(newOptions);
  }

  onAttachSelectedToCake(): void {
    this.sceneService.attachSelectedToCake();
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
    this.onExportGltf();
  }

  onExportObj(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const data = this.sceneService.exportOBJ();
    const blob = new Blob([data], { type: 'text/plain' });
    this.triggerDownload(blob, 'cake-scene.obj');
  }

  onExportStl(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const data = this.sceneService.exportSTL();
    const blob = new Blob([data], { type: 'application/sla' });
    this.triggerDownload(blob, 'cake-scene.stl');
  }

  onExportGltf(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.sceneService.exportGLTF((gltf) => {
      const serialized = JSON.stringify(gltf, null, 2);
      const blob = new Blob([serialized], { type: 'model/gltf+json' });
      this.triggerDownload(blob, 'cake-scene.gltf');
    });
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

  private initializeScene() {
    if (isPlatformBrowser(this.platformId)) {
      this.sceneService.init(this.container.nativeElement, this.options);
    }
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
