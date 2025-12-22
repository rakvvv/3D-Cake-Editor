import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { HistoryService } from './interaction/history/history.service';

/**
 * Centralizes per-project lifecycle so singleton services can reset isolated state.
 */
@Injectable({ providedIn: 'root' })
export class ProjectLifecycleService {
  private currentProjectId: string | null = null;
  private readonly projectId$ = new BehaviorSubject<string | null>(null);

  constructor(private readonly history: HistoryService) {}

  public get activeProjectId(): string | null {
    return this.currentProjectId;
  }

  public initializeProject(projectId?: string): string {
    const nextId = projectId ?? `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.currentProjectId = nextId;
    this.projectId$.next(nextId);
    this.history.resetAll();
    return nextId;
  }

  public disposeProject(): void {
    this.currentProjectId = null;
    this.projectId$.next(null);
    this.history.resetAll();
  }

  public onProjectIdChange(): BehaviorSubject<string | null> {
    return this.projectId$;
  }
}
