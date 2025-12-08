import { Routes } from '@angular/router';
import { CakeEditorComponent } from './cake-editor/cake-editor.component';
import { LoginComponent } from './auth/login.component';
import { RegisterComponent } from './auth/register.component';
import { ProjectListComponent } from './project-list/project-list.component';
import { authGuard } from './services/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'projects', component: ProjectListComponent, canActivate: [authGuard] },
  { path: 'editor/:projectId', component: CakeEditorComponent, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'projects' },
  { path: '**', redirectTo: 'projects' }
];
