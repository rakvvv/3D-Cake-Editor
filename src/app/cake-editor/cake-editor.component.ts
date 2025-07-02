import {Component, AfterViewInit, ViewChild, ElementRef, Inject, PLATFORM_ID} from '@angular/core';
import {CommonModule} from '@angular/common';
import {CakeSidebarComponent} from '../cake-sidebar/cake-sidebar.component';
import {ThreeSceneService} from '../services/three-scene.service';
import {isPlatformBrowser} from '@angular/common';
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

  constructor(private sceneService: ThreeSceneService, private transformService: TransformControlsService, @Inject(PLATFORM_ID) private platformId: Object) {
  }
  paintMode = false;
  currentBrush = 'trawa.glb';

  ngAfterViewInit(): void {
    this.initializeScene();
  }

  onAddDecoration(templateId: string): void {
    this.sceneService.addDecorationFromModel(templateId, this.options);
  }

  updateCakeOptions(newOptions: CakeOptions): void {
    this.options = newOptions;
    this.sceneService.updateCakeOptions(newOptions);
  }

  onAttachSelectedToCake(): void {
    this.sceneService.attachSelectedToCake();
  }

  private initializeScene() {
    if (isPlatformBrowser(this.platformId)) {
      this.sceneService.init(this.container.nativeElement, this.options);
    }
  }
  onTransformModeChange(mode: string): void {
    if (isPlatformBrowser(this.platformId)) {
      this.transformService.setTransformMode(mode as 'translate' | 'rotate' | 'scale');
    }
  }

  onTogglePaintMode(enabled: boolean): void {
    this.paintMode = enabled;
    this.sceneService.paintMode = enabled;
  }

  onBrushChanged(brushId: string): void {
    this.currentBrush = brushId;
    this.sceneService.currentBrush = brushId;
  }

}
