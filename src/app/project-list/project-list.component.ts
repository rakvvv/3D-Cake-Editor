import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ProjectsService } from '../services/projects.service';
import { CakeProjectSummaryDto } from '../models/project.models';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './project-list.component.html',
  styleUrl: './project-list.component.css',
})
export class ProjectListComponent implements OnInit {
  projects: CakeProjectSummaryDto[] = [];
  loading = true;
  newProjectName = 'Nowy tort';
  renameProjectId: number | null = null;
  renameValue = '';

  constructor(private projectsService: ProjectsService, private router: Router) {}

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

  private refreshAfterMutation(): void {
    this.cancelRename();
    this.loadProjects();
  }
}
