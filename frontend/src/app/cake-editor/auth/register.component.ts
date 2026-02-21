import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
})
export class RegisterComponent {
  email = '';
  password = '';
  confirmPassword = '';
  error: string | null = null;
  success: string | null = null;

  constructor(private authService: AuthService, private router: Router) {}

  onSubmit(): void {
    this.error = null;
    this.success = null;

    if (this.password !== this.confirmPassword) {
      this.error = 'Hasła nie są identyczne.';
      return;
    }

    this.authService.register(this.email, this.password).subscribe({
      next: (res) => {
        this.success = res.message;
      },
      error: (err) => {
        const msg = err?.error?.message;
        if (msg?.includes('Email already registered')) {
          this.error = 'Ten adres email jest już zarejestrowany.';
        } else if (msg?.includes('at least 8 characters')) {
          this.error = 'Hasło musi mieć co najmniej 8 znaków.';
        } else if (msg?.includes('too weak')) {
          this.error = 'Hasło jest zbyt słabe. Wybierz inne.';
        } else {
          this.error = 'Rejestracja nie powiodła się.';
        }
      },
    });
  }
}
