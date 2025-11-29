import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CakeOptions, TextureMaps } from '../../models/cake.options';

interface TextureSet {
  id: string;
  label: string;
  thumbnail?: string | null;
  cake?: TextureMaps | null;
  glaze?: TextureMaps | null;
}

interface TextureIndexResponse {
  sets: TextureSet[];
}

@Component({
  selector: 'app-textures-panel',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './textures-panel.component.html',
  styleUrls: ['./textures-panel.component.css'],
})
export class TexturesPanelComponent implements OnInit {
  @Input({ required: true }) options!: CakeOptions;
  @Output() cakeOptionsChange = new EventEmitter<CakeOptions>();

  public textureSets: TextureSet[] = [];
  public isLoading = true;
  public hasError = false;

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.loadTextureSets();
  }

  applyTextureSet(target: 'cake' | 'glaze', set: TextureSet): void {
    if (target === 'cake' && !set.cake) {
      return;
    }
    if (target === 'glaze' && !set.glaze) {
      return;
    }

    const updatedOptions: CakeOptions = {
      ...this.options,
      cake_textures: target === 'cake' ? set.cake ?? null : this.options.cake_textures ?? null,
      glaze_textures: target === 'glaze' ? set.glaze ?? null : this.options.glaze_textures ?? null,
    };

    this.cakeOptionsChange.emit(updatedOptions);
  }

  clearTextures(target: 'cake' | 'glaze'): void {
    const updatedOptions: CakeOptions = {
      ...this.options,
      cake_textures: target === 'cake' ? null : this.options.cake_textures ?? null,
      glaze_textures: target === 'glaze' ? null : this.options.glaze_textures ?? null,
    };

    this.cakeOptionsChange.emit(updatedOptions);
  }

  private async loadTextureSets(): Promise<void> {
    this.isLoading = true;
    this.hasError = false;
    try {
      const response = await firstValueFrom(
        this.http.get<TextureIndexResponse>('/assets/textures/index.json'),
      );
      this.textureSets = response?.sets ?? [];
    } catch (error) {
      console.error('Nie udało się załadować listy tekstur', error);
      this.textureSets = [];
      this.hasError = true;
    } finally {
      this.isLoading = false;
    }
  }
}
