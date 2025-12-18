import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';

import { TextureIndexDto, TextureSet } from '../models/texture-set';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TexturesService {
  private readonly endpoint = `${environment.apiBaseUrl}/textures`;
  private readonly setsSubject = new BehaviorSubject<TextureSet[]>([]);
  readonly sets$ = this.setsSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  loadTextureSets(): Observable<TextureSet[]> {
    return this.http.get<TextureIndexDto>(this.endpoint).pipe(
      map((response) => response?.sets ?? []),
      tap((sets) => this.setsSubject.next(sets)),
    );
  }

  get currentSets(): TextureSet[] {
    return this.setsSubject.value;
  }
}
