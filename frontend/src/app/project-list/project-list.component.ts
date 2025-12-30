import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ProjectsService } from '../services/projects.service';
import { CakeProjectSummaryDto } from '../models/project.models';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-list.component.html',
  styleUrl: './project-list.component.css',
})
export class ProjectListComponent implements OnInit {
  projects: CakeProjectSummaryDto[] = [];
  loading = true;
  newProjectName = 'Nowy tort';
  searchQuery = '';
  renameProjectId: number | null = null;
  renameValue = '';
  userMenuOpen = false;
  defaultThumbnail = '/assets/projects/thumbnail-placeholder.svg';
  private readonly apiBaseUrl = environment.apiBaseUrl;

  get filteredProjects(): CakeProjectSummaryDto[] {
    const term = this.searchQuery.trim().toLowerCase();
    if (!term) {
      return this.projects;
    }

    return this.projects.filter((project) => project.name.toLowerCase().includes(term));
  }

  get isAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  get user$() {
    return this.auth.currentUser$;
  }

  constructor(
    private projectsService: ProjectsService,
    private router: Router,
    private auth: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.loading = true;
    this.projectsService.listProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  createProject(): void {
    const name = this.newProjectName?.trim() || 'Nowy tort';
    this.projectsService.createProject(name).subscribe((project) => {
      this.newProjectName = 'Nowy tort';
      this.searchQuery = '';
      void this.router.navigate(['/editor', project.id]);
    });
  }

  openProject(id: number): void {
    void this.router.navigate(['/editor', id]);
  }

  startRename(project: CakeProjectSummaryDto): void {
    this.renameProjectId = project.id;
    this.renameValue = project.name;
  }

  confirmRename(project: CakeProjectSummaryDto): void {
    if (!this.renameValue.trim()) {
      this.cancelRename();
      return;
    }

    this.projectsService.getProject(project.id).subscribe((detail) => {
      this.projectsService
        .updateProject(project.id, { name: this.renameValue, dataJson: detail.dataJson })
        .subscribe(() => this.refreshAfterMutation());
    });
  }

  deleteProject(project: CakeProjectSummaryDto): void {
    this.projectsService.deleteProject(project.id).subscribe(() => this.refreshAfterMutation());
  }

  cancelRename(): void {
    this.renameProjectId = null;
    this.renameValue = '';
  }

  toggleUserMenu(): void {
    this.userMenuOpen = !this.userMenuOpen;
  }

  logout(): void {
    this.auth.logout();
    this.userMenuOpen = false;
    void this.router.navigate(['/login']);
  }

  goToLogin(): void {
    void this.router.navigate(['/login']);
  }

  goToAdmin(): void {
    void this.router.navigate(['/admin']);
    this.userMenuOpen = false;
  }

  onProjectThumbnailError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.src === new URL(this.defaultThumbnail, img.baseURI).toString()) {
      return;
    }
    img.src = this.defaultThumbnail;
  }

  getProjectThumbnail(project: CakeProjectSummaryDto): string {
    return this.normalizeProjectThumbnail(project.thumbnailUrl) || this.defaultThumbnail;
  }

  private normalizeProjectThumbnail(url?: string | null): string | null {
    if (!url) {
      return null;
    }

    if (/^(data:|blob:)/i.test(url)) {
      return url;
    }

    if (this.apiBaseUrl && !this.apiBaseUrl.startsWith('/')) {
      try {
        const apiBase = new URL(this.apiBaseUrl);

        if (url.startsWith('/api/')) {
          return new URL(url, apiBase).toString();
        }

        if (/^https?:/i.test(url)) {
          const parsed = new URL(url);
          if (parsed.pathname.startsWith('/api/') && parsed.origin !== apiBase.origin) {
            return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, apiBase).toString();
          }
        }
      } catch {
        return url;
      }
    }

    return url;
  }

  private refreshAfterMutation(): void {
    this.cancelRename();
    this.loadProjects();
  }
}
