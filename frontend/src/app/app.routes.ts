import { Routes } from '@angular/router';
import { CakeEditorComponent } from './cake-editor/cake-editor.component';
import { LoginComponent } from './cake-editor/auth/login.component';
import { RegisterComponent } from './cake-editor/auth/register.component';
import { VerifyEmailComponent } from './cake-editor/auth/verify-email.component';
import { ForgotPasswordComponent } from './cake-editor/auth/forgot-password.component';
import { ResetPasswordComponent } from './cake-editor/auth/reset-password.component';
import { ProjectListComponent } from './project-list/project-list.component';
import { authGuard } from './services/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'verify-email', component: VerifyEmailComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'reset-password', component: ResetPasswordComponent },
  { path: 'projects', component: ProjectListComponent, canActivate: [authGuard] },
  { path: 'editor/:projectId', component: CakeEditorComponent, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'projects' },
  { path: '**', redirectTo: 'projects' }
];
