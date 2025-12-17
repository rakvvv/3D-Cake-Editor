import { CommonModule } from '@angular/common';
import { Component, Input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnchorPresetsService } from '../../../services/anchor-presets.service';
import { AdminPresetService } from '../../../services/admin-preset.service';
import { CakePresetsService } from '../../../services/cake-presets.service';
import { ThreeSceneService } from '../../../services/three-scene.service';

@Component({
  selector: 'app-sidebar-admin-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-admin-panel.component.html',
  styleUrls: ['./sidebar-admin-panel.component.css'],
})
export class SidebarAdminPanelComponent {
  @Input() cakeShape?: string;
  @Input() cakeSize?: string;
  @Input() tiers?: number;

  cakePresetName = 'Gotowy tort';
  cakePresetDescription = '';
  anchorPresetName = 'Sloty dekoracji';

  savingCake = false;
  savingAnchors = false;

  statusMessage = signal('');
  errorMessage = signal('');

  constructor(
    private readonly sceneService: ThreeSceneService,
    private readonly adminPresetService: AdminPresetService,
    private readonly cakePresetsService: CakePresetsService,
    private readonly anchorPresetsService: AnchorPresetsService,
  ) {}

  async saveDecoratedCakePreset(): Promise<void> {
    this.statusMessage.set('');
    this.errorMessage.set('');
    this.savingCake = true;

    try {
      const preset = this.sceneService.buildDecoratedCakePreset(this.cakePresetName || 'Gotowy tort');
      preset.description = this.cakePresetDescription?.trim() || undefined;

      const payload = {
        presetId: preset.id,
        name: preset.name,
        description: preset.description,
        cakeShape: this.cakeShape,
        cakeSize: this.cakeSize,
        tiers: this.tiers,
        dataJson: JSON.stringify(preset),
      };

      await this.adminPresetService.saveCakePreset(payload);

      try {
        const blob = await this.sceneService.generateCakeThumbnailBlob();
        await this.adminPresetService.uploadCakePresetThumbnail(payload.presetId, blob);
      } catch (thumbnailError) {
        console.warn('Nie udało się zapisać miniatury presetu tortu', thumbnailError);
      }

      await this.cakePresetsService.loadPresets();
      this.statusMessage.set('Zapisano gotowy tort.');
    } catch (error) {
      console.error(error);
      this.errorMessage.set('Nie udało się zapisać gotowego tortu.');
    } finally {
      this.savingCake = false;
    }
  }

  async saveAnchorPreset(): Promise<void> {
    this.statusMessage.set('');
    this.errorMessage.set('');
    this.savingAnchors = true;

    try {
      const anchorPreset = this.sceneService.exportAllAnchors();
      if (!anchorPreset) {
        this.errorMessage.set('Brak kotwic do zapisania.');
        return;
      }

      const name = this.anchorPresetName?.trim() || anchorPreset.name || 'Sloty dekoracji';
      const payload = {
        presetId: anchorPreset.id,
        name,
        cakeShape: this.cakeShape,
        cakeSize: this.cakeSize,
        tiers: this.tiers,
        dataJson: JSON.stringify({ ...anchorPreset, name }),
      };

      await this.adminPresetService.saveAnchorPreset(payload);
      await this.anchorPresetsService.loadPresets();
      this.statusMessage.set('Zapisano preset kotwic dla tego tortu.');
    } catch (error) {
      console.error(error);
      this.errorMessage.set('Nie udało się zapisać presetów kotwic.');
    } finally {
      this.savingAnchors = false;
    }
  }
}
