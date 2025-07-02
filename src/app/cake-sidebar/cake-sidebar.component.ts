import {Component, Output, EventEmitter, output, NgIterable} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CakeOptions } from '../models/cake.options';
import {DecorationInfo} from '../models/decorationInfo';


@Component({
  selector: 'app-cake-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cake-sidebar.component.html',
  styleUrls: ['./cake-sidebar.component.css']
})
export class CakeSidebarComponent {
  addDecorationEvent = output<string>();
  saveSceneEvent = output<void>(); // Nadal istnieje, choć nieużywane w edytorze?
  attachSelectedToCake = output<void>();
  cakeOptionsChange = output<CakeOptions>();
  transformModeChange = output<string>();


  // Opcje tortu
  cakeSize: number = 1;
  cakeColor: string = '#ffea00';
  cakeText: boolean = false;
  cakeTextValue: string = 'Urodziny';

  onAddDecoration(templateId: string): void {
    this.addDecorationEvent.emit(templateId);
  }

  onSaveScene(): void {
    this.saveSceneEvent.emit();
  }

  onAttachSelectedToCake(): void {
    this.attachSelectedToCake.emit();
  }

  updateCakeOptions(): void {
    this.cakeOptionsChange.emit(<CakeOptions>{
      cake_size: this.cakeSize,
      cake_color: this.cakeColor,
      cake_text: this.cakeText,
      cake_text_value: this.cakeTextValue
    });
  }
  decorationsList: DecorationInfo[] = [
    { name: 'Cyfra 1', modelFileName: 'Numer_1.glb', type: 'TOP' },
    { name: 'Ozdoba Boczna', modelFileName: 'custom.glb', type: 'SIDE' },
    { name: 'Czekoladowa ozdoba', modelFileName: 'chocolate_kiss.glb', type: 'TOP' },
    { name: 'Trawa', modelFileName: 'trawa.glb', type: 'SIDE' }
  ];

  setTransformMode(mode: string): void {
    console.log('Sidebar: Zmiana trybu na', mode);
    this.transformModeChange.emit(mode);
  }

  brushList: { id: string; name: string }[] = [
    { id: 'trawa.glb', name: 'Trawa' },
    { id: 'chocolate_kiss.glb', name: 'Stożek' },
    // dodaj tu inne pędzle
  ];
  selectedBrush = this.brushList[0].id;
  paintMode = false;

  @Output() paintModeChange = new EventEmitter<boolean>();
  @Output() brushChange = new EventEmitter<string>();

  togglePaintMode(): void {
    this.paintMode = !this.paintMode;
    this.paintModeChange.emit(this.paintMode);
  }

  onBrushChange(): void {
    this.brushChange.emit(this.selectedBrush);
  }
}
