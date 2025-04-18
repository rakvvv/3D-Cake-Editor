import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {CakeOptions} from '../models/cake.options';

@Component({
  selector: 'app-cake-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cake-sidebar.component.html',
  styleUrls: ['./cake-sidebar.component.css']
})
export class CakeSidebarComponent {
  @Output() addDecorationEvent = new EventEmitter<string>();
  @Output() saveSceneEvent = new EventEmitter<void>();
  @Output() attachSelectedToCake = new EventEmitter<void>();
  @Output() cakeOptionsChange = new EventEmitter<CakeOptions>();


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
}
