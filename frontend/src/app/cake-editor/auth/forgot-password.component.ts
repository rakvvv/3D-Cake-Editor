import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.css',
})
export class ForgotPasswordComponent {
  email = '';
  message: string | null = null;
  error: string | null = null;

  constructor(private authService: AuthService) {}

  onSubmit(): void {
    this.error = null;
    this.message = null;

    this.authService.forgotPassword(this.email).subscribe({
      next: (res) => {
        this.message = res.message;
      },
      error: () => {
        this.error = 'Wystąpił błąd. Spróbuj ponownie później.';
      },
    });
  }
}
