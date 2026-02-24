import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.css',
})
export class ResetPasswordComponent implements OnInit {
  token = '';
  password = '';
  confirmPassword = '';
  message: string | null = null;
  error: string | null = null;

  constructor(private route: ActivatedRoute, private authService: AuthService) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.token = params.get('token') || '';
      if (!this.token) {
        this.error = 'Brak tokenu resetu hasła. Sprawdź link z emaila.';
      }
    });
  }

  onSubmit(): void {
    this.error = null;
    this.message = null;

    if (this.password.length < 8) {
      this.error = 'Hasło musi mieć co najmniej 8 znaków.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.error = 'Hasła nie są identyczne.';
      return;
    }

    this.authService.resetPassword(this.token, this.password).subscribe({
      next: (res) => {
        this.message = res.message;
      },
      error: (err) => {
        const msg = err?.error?.message;
        if (msg?.includes('wygasł') || msg?.includes('Nieprawidłowy')) {
          this.error = 'Token wygasł lub jest nieprawidłowy. Poproś o nowy link.';
        } else if (msg?.includes('at least 8 characters')) {
          this.error = 'Hasło musi mieć co najmniej 8 znaków.';
        } else if (msg?.includes('too weak')) {
          this.error = 'Hasło jest zbyt słabe. Wybierz inne.';
        } else {
          this.error = msg || 'Reset hasła nie powiódł się. Spróbuj ponownie.';
        }
      },
    });
  }
}
