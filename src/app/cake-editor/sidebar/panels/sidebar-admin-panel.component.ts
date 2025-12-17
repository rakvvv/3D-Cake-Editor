import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnchorPresetsService } from '../../../services/anchor-presets.service';
import { AdminPresetService } from '../../../services/admin-preset.service';
import { CakePresetsService } from '../../../services/cake-presets.service';
import { ThreeSceneService } from '../../../services/three-scene.service';
import { DecorationsService } from '../../../services/decorations.service';
import { AuthService } from '../../../services/auth.service';
import { AnchorPoint, AnchorPreset } from '../../../models/anchors';
import { Subscription } from 'rxjs';
import { DecorationInfo } from '../../../models/decorationInfo';

@Component({
  selector: 'app-sidebar-admin-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar-admin-panel.component.html',
  styleUrls: ['./sidebar-admin-panel.component.css'],
})
export class SidebarAdminPanelComponent implements OnInit, OnDestroy {
  @Input() cakeShape?: string;
  @Input() cakeSize?: string;
  @Input() tiers?: number;

  cakePanelOpen = true;
  anchorsPanelOpen = true;
  cakePresetName = 'Gotowy tort';
  cakePresetDescription = '';
  anchorPresetName = 'Sloty dekoracji';
  recordAnchorOptions = false;
  anchorPresets: AnchorPreset[] = [];
  activeAnchorId: string | null = null;
  decorationSearch = '';
  availableDecorations: DecorationInfo[] = [];
  selectedPresetId: string | null = null;
  hiddenOptions = new Set<string>();

  private subscriptions = new Subscription();
  private lastEditedAnchor?: string;
  private markersPreviouslyVisible = false;

  savingCake = false;
  savingAnchors = false;

  statusMessage = signal('');
  errorMessage = signal('');

  constructor(
    private readonly sceneService: ThreeSceneService,
    private readonly adminPresetService: AdminPresetService,
    private readonly cakePresetsService: CakePresetsService,
    private readonly anchorPresetsService: AnchorPresetsService,
    private readonly decorationsService: DecorationsService,
    private readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.markersPreviouslyVisible = this.anchorPresetsService.areMarkersVisible();
    this.anchorPresetsService.setMarkersVisible(true);
    this.sceneService.showAllAnchorDecorations();
    this.anchorPresetsService.setPendingDecoration(null);

    this.subscriptions.add(
      this.anchorPresetsService.presets$.subscribe((presets) => {
        this.anchorPresets = presets ?? [];
        if (!this.selectedPresetId && presets.length) {
          this.selectedPresetId = presets[0].id;
        }
        this.syncAnchorPresetName();
      }),
    );

    this.subscriptions.add(
      this.anchorPresetsService.activePresetId$.subscribe((id) => {
        this.selectedPresetId = id;
        if (id && this.lastEditedAnchor) {
          const hasAnchor = this.getAnchors().some((anchor) => anchor.id === this.lastEditedAnchor);
          if (!hasAnchor) {
            this.lastEditedAnchor = undefined;
            this.activeAnchorId = null;
          }
        }
        this.syncAnchorPresetName();
      }),
    );

    this.subscriptions.add(
      this.anchorPresetsService.anchorClicks$.subscribe((anchorId) => {
        this.focusAnchor(anchorId);
      }),
    );

    this.subscriptions.add(
      this.decorationsService.decorations$.subscribe((decorations) => {
        this.availableDecorations = decorations ?? [];
      }),
    );

    this.availableDecorations = this.decorationsService.getDecorations();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.anchorPresetsService.setFocusedAnchor(null);
    this.sceneService.showAllAnchorDecorations();
    this.anchorPresetsService.setRecordingOptions(false);
    this.anchorPresetsService.setMarkersVisible(this.markersPreviouslyVisible);
    this.anchorPresetsService.setPendingDecoration(null);
    this.recordAnchorOptions = false;
  }

  async saveDecoratedCakePreset(): Promise<void> {
    this.statusMessage.set('');
    this.errorMessage.set('');
    this.savingCake = true;

    try {
      if (!this.isAdminAuthenticated()) {
        this.errorMessage.set('Zaloguj się jako administrator, aby zapisać preset tortu.');
        return;
      }

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
      const forbidden = (error as { status?: number }).status === 403;
      this.errorMessage.set(forbidden ? 'Brak uprawnień administratora do zapisu.' : 'Nie udało się zapisać gotowego tortu.');
    } finally {
      this.savingCake = false;
    }
  }

  async saveAnchorPreset(saveAsNew = false): Promise<void> {
    this.statusMessage.set('');
    this.errorMessage.set('');
    this.savingAnchors = true;

    try {
      if (!this.isAdminAuthenticated()) {
        this.errorMessage.set('Zaloguj się jako administrator, aby zapisać presety kotwic.');
        return;
      }

      const anchorPreset = this.sceneService.exportAllAnchors();
      if (!anchorPreset) {
        this.errorMessage.set('Brak kotwic do zapisania.');
        return;
      }

      const name = this.anchorPresetName?.trim() || anchorPreset.name || 'Sloty dekoracji';
      const presetId = saveAsNew ? `preset-${Date.now()}` : this.selectedPresetId ?? anchorPreset.id;
      const payload = {
        presetId,
        name,
        cakeShape: this.cakeShape,
        cakeSize: this.cakeSize,
        tiers: this.tiers,
        dataJson: JSON.stringify({ ...anchorPreset, id: presetId, name }),
      };

      if (saveAsNew || !this.selectedPresetId) {
        await this.adminPresetService.saveAnchorPreset(payload);
      } else {
        await this.adminPresetService.updateAnchorPreset(payload);
      }
      await this.anchorPresetsService.loadPresets();
      this.statusMessage.set(
        saveAsNew ? 'Zapisano nowy preset kotwic dla tego tortu.' : 'Zapisano zmodyfikowany preset kotwic.',
      );
      this.selectedPresetId = payload.presetId;
      this.anchorPresetsService.setActivePreset(payload.presetId);
      this.anchorPresetName = name;
    } catch (error) {
      console.error(error);
      const forbidden = (error as { status?: number }).status === 403;
      this.errorMessage.set(forbidden ? 'Brak uprawnień administratora do zapisu.' : 'Nie udało się zapisać presetów kotwic.');
    } finally {
      this.savingAnchors = false;
    }
  }

  private isAdminAuthenticated(): boolean {
    const currentUser = this.authService.getCurrentUser();
    if (this.authService.isAuthenticated() && currentUser?.role === 'ADMIN') {
      return true;
    }
    this.authService.logout();
    return false;
  }

  focusAnchor(anchorId: string): void {
    this.sceneService.showAllAnchorDecorations();
    this.activeAnchorId = anchorId;
    this.lastEditedAnchor = anchorId;
    this.anchorPresetsService.setFocusedAnchor(anchorId);
    this.statusMessage.set(`Edytujesz kotwicę ${anchorId}.`);
    this.hiddenOptions.clear();
    this.sceneService.showAllAnchorDecorations(anchorId);
  }

  focusAnchorOption(anchorId: string, decorationId: string): void {
    this.statusMessage.set('');
    this.errorMessage.set('');

    this.focusAnchor(anchorId);
    void this.sceneService.ensureAnchorDecorationForEdit(anchorId, decorationId).then((result) => {
      if (!result.success) {
        this.errorMessage.set(result.message);
        return;
      }
      this.statusMessage.set(result.message);
    });
  }

  getAnchors(): AnchorPoint[] {
    return this.anchorPresetsService.getActivePreset()?.anchors ?? [];
  }

  onPresetSelectionChange(presetId: string): void {
    this.selectedPresetId = presetId;
    this.anchorPresetsService.setActivePreset(presetId);
    this.activeAnchorId = null;
    this.anchorPresetsService.setFocusedAnchor(null);
    this.sceneService.showAllAnchorDecorations();
    this.hiddenOptions.clear();
    this.syncAnchorPresetName();
  }

  listAllowedOptions(anchor: AnchorPoint): string[] {
    return anchor.allowedDecorationIds ?? [];
  }

  async addDecorationToAnchor(decoration: DecorationInfo): Promise<void> {
    if (!this.activeAnchorId) {
      this.errorMessage.set('Najpierw wybierz kotwicę z listy.');
      return;
    }

    this.anchorPresetsService.setPendingDecoration(decoration);
    const anchorDecorationId = decoration.modelFileName || decoration.id;

    if (!anchorDecorationId) {
      this.errorMessage.set('Nie można ustalić identyfikatora dekoracji.');
      return;
    }

    if (!this.recordAnchorOptions) {
      this.recordAnchorOptions = true;
      this.anchorPresetsService.setRecordingOptions(true);
    }

    this.statusMessage.set('Umieszczanie dekoracji na kotwicy…');
    const result = await this.sceneService.ensureAnchorDecorationForEdit(
      this.activeAnchorId,
      anchorDecorationId,
    );
    if (!result.success) {
      this.errorMessage.set(result.message);
      return;
    }

    const added = this.anchorPresetsService.appendAllowedDecoration(this.activeAnchorId, anchorDecorationId);
    if (added) {
      this.sceneService.markAnchorOptionAddition(this.activeAnchorId, anchorDecorationId);
    }
    this.statusMessage.set('Dodano dekorację jako opcję dla kotwicy.');
    this.sceneService.showAllAnchorDecorations(this.activeAnchorId);
  }

  async removeDecorationFromAnchor(anchorId: string, decorationId: string): Promise<void> {
    this.errorMessage.set('');

    const removed = this.anchorPresetsService.removeAllowedDecoration(anchorId, decorationId);
    if (!removed) {
      this.errorMessage.set('Nie udało się usunąć dekoracji z kotwicy.');
      return;
    }

    this.sceneService.removeAnchorDecoration(anchorId, decorationId);
    this.hiddenOptions.delete(`${anchorId}:${decorationId}`);
    this.statusMessage.set('Usunięto dekorację z opcji kotwicy.');
  }

  async toggleDecorationVisibility(anchorId: string, decorationId: string): Promise<void> {
    const key = `${anchorId}:${decorationId}`;
    const shouldHide = !this.hiddenOptions.has(key);

    const ensureResult = await this.sceneService.ensureAnchorDecorationForEdit(anchorId, decorationId);
    if (!ensureResult.success) {
      this.errorMessage.set(ensureResult.message);
      return;
    }

    if (shouldHide) {
      this.hiddenOptions.add(key);
    } else {
      this.hiddenOptions.delete(key);
    }

    this.sceneService.setAnchorOptionVisibility(anchorId, decorationId, !shouldHide);
    this.statusMessage.set(shouldHide ? 'Ukryto dekorację na podglądzie.' : 'Dekoracja znów jest widoczna.');
  }

  filteredDecorations(): DecorationInfo[] {
    const term = this.decorationSearch.trim().toLowerCase();
    if (!term) {
      return this.availableDecorations;
    }
    return this.availableDecorations.filter((decoration) =>
      decoration.name.toLowerCase().includes(term) ||
      decoration.id.toLowerCase().includes(term) ||
      decoration.modelFileName.toLowerCase().includes(term),
    );
  }

  getDecorationThumbnail(decoration: DecorationInfo): string {
    if (decoration.thumbnailUrl) {
      return decoration.thumbnailUrl;
    }
    if (decoration.modelFileName?.endsWith('.glb')) {
      const guess = `/assets/decorations/thumbnails/${decoration.modelFileName.replace('.glb', '.png')}`;
      return guess;
    }
    return '/assets/decorations/thumbnails/placeholder.svg';
  }

  onDecorationThumbnailError(event: Event, decoration: DecorationInfo): void {
    const target = event.target as HTMLImageElement;
    target.src = '/assets/decorations/thumbnails/placeholder.svg';
    target.alt = `${decoration.name} (miniatura niedostępna)`;
  }

  resolveDecorationName(identifier: string): string {
    const decoration = this.decorationsService.getDecorationInfo(identifier);
    return decoration?.name ?? identifier;
  }

  resolveDecorationThumbnail(identifier: string): string {
    const decoration = this.decorationsService.getDecorationInfo(identifier);
    return decoration?.thumbnailUrl ?? '/assets/decorations/thumbnails/placeholder.svg';
  }

  onAnchorOptionThumbnailError(event: Event, identifier: string): void {
    const target = event.target as HTMLImageElement;
    target.src = '/assets/decorations/thumbnails/placeholder.svg';
    target.alt = `${identifier} (miniatura niedostępna)`;
  }

  private syncAnchorPresetName(): void {
    if (!this.selectedPresetId) {
      return;
    }

    const preset = this.anchorPresets.find((candidate) => candidate.id === this.selectedPresetId);
    if (preset?.name) {
      this.anchorPresetName = preset.name;
    }
  }
}
