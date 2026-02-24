import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { AppThemeService } from './services/app-theme.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HttpClientModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  host: {
    '[class.light-theme]': 'isLightTheme',
  },
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'cukiernia-online';
  isLightTheme = false;
  private sub?: Subscription;

  constructor(private themeService: AppThemeService) {}

  ngOnInit(): void {
    this.isLightTheme = this.themeService.isLight();
    this.sub = this.themeService.theme$.subscribe(() => {
      this.isLightTheme = this.themeService.isLight();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
