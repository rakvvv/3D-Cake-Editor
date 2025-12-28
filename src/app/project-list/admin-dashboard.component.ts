import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, takeUntil } from 'rxjs';
import { DecorationsService } from '../services/decorations.service';
import { DecorationInfo } from '../models/decorationInfo';
import { environment } from '../../environments/environment';

type DecorationStatus = 'DRAFT' | 'ACTIVE' | 'HIDDEN' | 'DEPRECATED';

type DecorationTag = 'top' | 'side' | 'paintable' | 'premium' | 'seasonal' | 'deprecated';
type AdminTab = 'moderation' | 'users' | 'analytics';
type SortOption = 'name-asc' | 'name-desc' | 'status-asc' | 'status-desc';

interface ModeratedDecoration extends DecorationInfo {
  status: DecorationStatus;
  tags: DecorationTag[];
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.css'],
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  readonly axisOptions: Array<'X' | 'Y' | 'Z'> = ['X', 'Y', 'Z'];
  readonly statusOptions: DecorationStatus[] = ['DRAFT', 'ACTIVE', 'HIDDEN', 'DEPRECATED'];
  readonly tagOptions: DecorationTag[] = ['top', 'side', 'paintable', 'premium', 'seasonal', 'deprecated'];
  readonly placementOptions: Array<DecorationInfo['type']> = ['TOP', 'SIDE', 'BOTH'];

  decorations: ModeratedDecoration[] = [];
  activeTab: AdminTab = 'moderation';
  searchTerm = '';
  selectedStatus: DecorationStatus | 'ALL' = 'ALL';
  selectedTag: DecorationTag | 'ALL' = 'ALL';
  selectedPlacement: DecorationInfo['type'] | 'ALL' = 'ALL';
  sortOption: SortOption = 'name-asc';
  pageSize = 6;
  currentPage = 1;
  loading = false;
  errorMessage = '';
  noticeMessage = '';

  private readonly statusOverrides = new Map<string, DecorationStatus>();
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly http: HttpClient,
    private readonly decorationsService: DecorationsService,
  ) {}

  ngOnInit(): void {
    this.fetchDecorations();

    this.decorationsService.decorations$
      .pipe(takeUntil(this.destroy$))
      .subscribe((decorations) => {
        this.decorations = decorations.map((decoration) => this.buildModeratedDecoration(decoration));
        this.currentPage = 1;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  addDecoration(): void {
    // Placeholder for future flow to add new decoration entries from the backend.
    this.noticeMessage = 'Dodawanie dekoracji będzie dostępne po podłączeniu formularza.';
  }

  deactivateDecoration(decoration: ModeratedDecoration): void {
    decoration.status = 'HIDDEN';
    this.statusOverrides.set(decoration.id, decoration.status);
  }

  togglePublish(decoration: ModeratedDecoration): void {
    if (decoration.status === 'ACTIVE') {
      decoration.status = 'HIDDEN';
    } else if (decoration.status === 'HIDDEN' || decoration.status === 'DRAFT') {
      decoration.status = 'ACTIVE';
    } else {
      decoration.status = 'HIDDEN';
    }

    this.statusOverrides.set(decoration.id, decoration.status);
  }

  publishLabel(status: DecorationStatus): string {
    return status === 'ACTIVE' ? 'Ukryj' : 'Publikuj';
  }

  setActiveTab(tab: AdminTab): void {
    this.activeTab = tab;
  }

  onFiltersChanged(): void {
    this.currentPage = 1;
  }

  totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredDecorations().length / this.pageSize));
  }

  pagedDecorations(): ModeratedDecoration[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredDecorations().slice(start, start + this.pageSize);
  }

  goToPage(page: number): void {
    const total = this.totalPages();
    this.currentPage = Math.min(Math.max(page, 1), total);
  }

  pageLabel(): string {
    return `${this.currentPage} / ${this.totalPages()}`;
  }

  filteredDecorations(): ModeratedDecoration[] {
    const term = this.searchTerm.trim().toLowerCase();

    const filtered = this.decorations.filter((decoration) => {
      if (this.selectedStatus !== 'ALL' && decoration.status !== this.selectedStatus) {
        return false;
      }

      if (this.selectedTag !== 'ALL' && !decoration.tags.includes(this.selectedTag)) {
        return false;
      }

      if (this.selectedPlacement !== 'ALL' && decoration.type !== this.selectedPlacement) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = `${decoration.name} ${decoration.id}`.toLowerCase();
      return haystack.includes(term);
    });

    return filtered.sort((a, b) => {
      switch (this.sortOption) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'status-asc':
          return a.status.localeCompare(b.status);
        case 'status-desc':
          return b.status.localeCompare(a.status);
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }

  rotationValue(decoration: ModeratedDecoration): number {
    return decoration.initialRotation?.[1] ?? 0;
  }

  setRotation(decoration: ModeratedDecoration, value: number): void {
    const rotation = decoration.initialRotation ?? [0, 0, 0];
    rotation[1] = value;
    decoration.initialRotation = rotation;
  }

  onThumbnailError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.src = '/assets/decorations/thumbnails/placeholder.svg';
  }

  resolveThumbnail(decoration: DecorationInfo): string {
    if (decoration.thumbnailUrl) {
      return decoration.thumbnailUrl;
    }

    return `/assets/decorations/thumbnails/${decoration.id}.png`;
  }

  private fetchDecorations(): void {
    this.loading = true;
    this.errorMessage = '';
    this.noticeMessage = '';

    this.http
      .get<DecorationInfo[]>(`${environment.apiBaseUrl}/${environment.endpoints.decorations}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (decorations) => {
          this.decorationsService.setDecorations(decorations ?? []);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.errorMessage = 'Nie udało się wczytać dekoracji z backendu.';
          this.decorationsService.setDecorations([]);
        },
      });
  }

  private buildModeratedDecoration(decoration: DecorationInfo): ModeratedDecoration {
    const normalized = this.applyDefaults(decoration);
    const status = this.statusOverrides.get(decoration.id) ?? this.extractStatus(decoration);
    const tags = this.resolveTags(normalized, status);

    return {
      ...normalized,
      status,
      tags,
    };
  }

  private applyDefaults(decoration: DecorationInfo): DecorationInfo {
    if (!decoration.initialScale) {
      decoration.initialScale = 1;
    }

    if (!decoration.initialRotation) {
      decoration.initialRotation = [0, 0, 0];
    }

    if (!decoration.modelUpAxis) {
      decoration.modelUpAxis = 'Y';
    }

    if (!decoration.modelForwardAxis) {
      decoration.modelForwardAxis = 'Z';
    }

    if (decoration.faceOutwardOnSides === undefined) {
      decoration.faceOutwardOnSides = true;
    }

    return decoration;
  }

  private extractStatus(decoration: DecorationInfo): DecorationStatus {
    const status = (decoration as { status?: DecorationStatus }).status;
    return status ?? 'ACTIVE';
  }

  private resolveTags(decoration: DecorationInfo, status: DecorationStatus): DecorationTag[] {
    const tags = new Set<DecorationTag>();

    if (decoration.type === 'TOP' || decoration.type === 'BOTH') {
      tags.add('top');
    }

    if (decoration.type === 'SIDE' || decoration.type === 'BOTH') {
      tags.add('side');
    }

    if (decoration.paintable) {
      tags.add('paintable');
    }

    if (this.isPremium(decoration)) {
      tags.add('premium');
    }

    if (this.isSeasonal(decoration)) {
      tags.add('seasonal');
    }

    if (status === 'DEPRECATED') {
      tags.add('deprecated');
    }

    return Array.from(tags.values());
  }

  private isPremium(decoration: DecorationInfo): boolean {
    const name = decoration.name?.toLowerCase() ?? '';
    const id = decoration.id?.toLowerCase() ?? '';
    return name.includes('figurka') || id.includes('figurine');
  }

  private isSeasonal(decoration: DecorationInfo): boolean {
    const name = decoration.name?.toLowerCase() ?? '';
    const id = decoration.id?.toLowerCase() ?? '';
    return name.includes('gwiazda') || id.includes('star') || id.includes('ribbon');
  }
}
