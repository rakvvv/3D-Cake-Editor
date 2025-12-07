import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { CakePresetsService } from '../../services/cake-presets.service';
import { DecoratedCakePreset } from '../../models/cake-preset';

@Component({
  selector: 'app-presets-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './presets-panel.component.html',
  styleUrls: ['./presets-panel.component.css'],
})
export class PresetsPanelComponent implements OnInit, OnDestroy {
  @Output() applyPreset = new EventEmitter<DecoratedCakePreset>();

  presets: DecoratedCakePreset[] = [];
  private subscription?: Subscription;

  constructor(private readonly cakePresetsService: CakePresetsService) {}

  ngOnInit(): void {
    void this.cakePresetsService.loadPresets();
    this.subscription = this.cakePresetsService.presets$.subscribe((presets) => {
      this.presets = presets;
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  onApplyPreset(preset: DecoratedCakePreset): void {
    this.applyPreset.emit(preset);
  }
}
