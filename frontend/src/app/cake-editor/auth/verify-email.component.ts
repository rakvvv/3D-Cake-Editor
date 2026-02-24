import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.css',
})
export class VerifyEmailComponent implements OnInit {
  message: string | null = null;
  error: string | null = null;
  loading = true;

  constructor(private route: ActivatedRoute, private authService: AuthService) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      const token = params.get('token');
      if (!token) {
        this.error = 'Brak tokenu weryfikacyjnego.';
        this.loading = false;
        return;
      }

      this.authService.verifyEmail(token).subscribe({
        next: (res) => {
          this.message = res.message;
          this.loading = false;
        },
        error: () => {
          this.error = 'Weryfikacja nie powiodła się. Link może być nieprawidłowy lub wygasły.';
          this.loading = false;
        },
      });
    });
  }
}
