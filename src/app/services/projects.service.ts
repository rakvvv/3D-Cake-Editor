import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CakeProjectDetailDto, CakeProjectSummaryDto, SaveCakeProjectRequest } from '../models/project.models';
import { DecoratedCakePreset } from '../models/cake-preset';
import { DEFAULT_CAKE_OPTIONS, cloneCakeOptions } from '../models/default-cake-options';

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly baseUrl = `${environment.apiBaseUrl}/projects`;

  constructor(private http: HttpClient) {}

  listProjects(): Observable<CakeProjectSummaryDto[]> {
    return this.http.get<CakeProjectSummaryDto[]>(this.baseUrl);
  }

  getProject(id: number): Observable<CakeProjectDetailDto> {
    return this.http.get<CakeProjectDetailDto>(`${this.baseUrl}/${id}`);
  }

  createProject(name: string, dataJson?: string): Observable<CakeProjectDetailDto> {
    const payload: SaveCakeProjectRequest = {
      name,
      dataJson: dataJson ?? this.buildEmptyProjectData(name),
    };
    return this.http.post<CakeProjectDetailDto>(this.baseUrl, payload);
  }

  updateProject(id: number, request: SaveCakeProjectRequest): Observable<CakeProjectDetailDto> {
    return this.http.put<CakeProjectDetailDto>(`${this.baseUrl}/${id}`, request);
  }

  deleteProject(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  buildEmptyProjectData(name: string): string {
    const preset: DecoratedCakePreset = {
      id: `project-${Date.now()}`,
      name,
      options: cloneCakeOptions(DEFAULT_CAKE_OPTIONS),
      decorations: [],
      paintStrokes: [],
    };
    return JSON.stringify(preset);
  }
}
