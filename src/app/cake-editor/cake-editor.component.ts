import {Component, AfterViewInit, ViewChild, ElementRef, Inject, PLATFORM_ID} from '@angular/core';
import {CommonModule} from '@angular/common';
import {CakeSidebarComponent} from '../cake-sidebar/cake-sidebar.component';
import {ThreeSceneService, CakeOptions} from '../services/three-scene.service';
import {isPlatformBrowser} from '@angular/common';

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

  constructor(private sceneService: ThreeSceneService, @Inject(PLATFORM_ID) private platformId: Object) {
  }

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

}
