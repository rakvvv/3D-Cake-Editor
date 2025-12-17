import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminPresetService, AnchorPresetPayload, DecoratedPresetPayload } from '../services/admin-preset.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.css'],
})
export class AdminDashboardComponent {
  cakePreset: DecoratedPresetPayload = {
    presetId: '',
    name: '',
    description: '',
    thumbnailUrl: '',
    cakeShape: '',
    cakeSize: '',
    tiers: 1,
    dataJson: '',
  };

  anchorPreset: AnchorPresetPayload = {
    presetId: '',
    name: '',
    cakeShape: '',
    cakeSize: '',
    tiers: 1,
    dataJson: '',
  };

  statusMessage = signal('');
  errorMessage = signal('');

  constructor(private readonly adminPresetService: AdminPresetService) {}

  async saveCakePreset(): Promise<void> {
    this.statusMessage.set('');
    this.errorMessage.set('');
    try {
      await this.adminPresetService.saveCakePreset(this.cakePreset);
      this.statusMessage.set('Zapisano nowy gotowy tort.');
    } catch (error) {
      console.error(error);
      this.errorMessage.set('Nie udało się zapisać gotowego tortu.');
    }
  }

  async saveAnchorPreset(): Promise<void> {
    this.statusMessage.set('');
    this.errorMessage.set('');
    try {
      await this.adminPresetService.saveAnchorPreset(this.anchorPreset);
      this.statusMessage.set('Zapisano preset kotwic.');
    } catch (error) {
      console.error(error);
      this.errorMessage.set('Nie udało się zapisać presetów kotwic.');
    }
  }
}
