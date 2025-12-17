import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnchorPresetsService } from '../../../services/anchor-presets.service';
import { AdminPresetService } from '../../../services/admin-preset.service';
import { CakePresetsService } from '../../../services/cake-presets.service';
import { ThreeSceneService } from '../../../services/three-scene.service';
import { DecorationsService } from '../../../services/decorations.service';
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

  cakePresetName = 'Gotowy tort';
  cakePresetDescription = '';
  anchorPresetName = 'Sloty dekoracji';
  recordAnchorOptions = false;
  anchorPresets: AnchorPreset[] = [];
  activeAnchorId: string | null = null;
  decorationSearch = '';
  availableDecorations: DecorationInfo[] = [];
  selectedPresetId: string | null = null;

  private subscriptions = new Subscription();
  private lastEditedAnchor?: string;

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
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.anchorPresetsService.presets$.subscribe((presets) => {
        this.anchorPresets = presets ?? [];
        if (!this.selectedPresetId && presets.length) {
          this.selectedPresetId = presets[0].id;
        }
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
  }

  toggleAnchorOptionRecording(): void {
    this.recordAnchorOptions = !this.recordAnchorOptions;
    this.anchorPresetsService.setRecordingOptions(this.recordAnchorOptions);
    this.statusMessage.set(
      this.recordAnchorOptions
        ? 'Tryb nagrywania opcji kotwic: kliknij marker i dodaj różne dekoracje.'
        : 'Tryb nagrywania opcji wyłączony.',
    );
  }

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
      this.selectedPresetId = payload.presetId;
      this.anchorPresetsService.setActivePreset(payload.presetId);
    } catch (error) {
      console.error(error);
      this.errorMessage.set('Nie udało się zapisać presetów kotwic.');
    } finally {
      this.savingAnchors = false;
    }
  }

  focusAnchor(anchorId: string): void {
    this.sceneService.showAllAnchorDecorations();
    this.activeAnchorId = anchorId;
    this.lastEditedAnchor = anchorId;
    this.anchorPresetsService.setFocusedAnchor(anchorId);
    this.statusMessage.set(`Edytujesz kotwicę ${anchorId}.`);
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
  }

  listAllowedOptions(anchor: AnchorPoint): string[] {
    return anchor.allowedDecorationIds ?? [];
  }

  async addDecorationToAnchor(decoration: DecorationInfo): Promise<void> {
    if (!this.activeAnchorId) {
      this.errorMessage.set('Najpierw wybierz kotwicę z listy.');
      return;
    }

    const identifiers = new Set([decoration.modelFileName, decoration.id].filter(Boolean) as string[]);

    if (!this.recordAnchorOptions) {
      this.recordAnchorOptions = true;
      this.anchorPresetsService.setRecordingOptions(true);
    }

    this.statusMessage.set('Umieszczanie dekoracji na kotwicy…');
    const identifier = decoration.id || decoration.modelFileName;
    const result = await this.sceneService.ensureAnchorDecorationForEdit(
      this.activeAnchorId,
      identifier!,
    );
    if (!result.success) {
      this.errorMessage.set(result.message);
      return;
    }

    identifiers.forEach((id) => this.anchorPresetsService.appendAllowedDecoration(this.activeAnchorId, id));
    this.statusMessage.set('Dodano dekorację jako opcję dla kotwicy.');
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
    return decoration.thumbnailUrl ?? '/assets/decorations/thumbnails/placeholder.svg';
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
}
