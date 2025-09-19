import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CakeOptions } from '../../models/cake.options';

@Component({
  selector: 'app-layers-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './layers-panel.component.html',
  styleUrls: ['./layers-panel.component.css']
})
export class LayersPanelComponent {
  @Output() cakeOptionsChange = new EventEmitter<CakeOptions>();

  cakeSize = 1;
  cakeColor = '#ffea00';
  cakeText = false;
  cakeTextValue = 'Urodziny';
  cakeLayers = 1;
  cakeShape: 'cylinder' | 'cuboid' = 'cylinder';

  updateCakeOptions(): void {
    this.cakeOptionsChange.emit({
      cake_size: this.cakeSize,
      cake_color: this.cakeColor,
      cake_text: this.cakeText,
      cake_text_value: this.cakeTextValue,
      layers: this.cakeLayers,
      shape: this.cakeShape,
    });
  }
}
