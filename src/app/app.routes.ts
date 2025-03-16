import { Routes } from '@angular/router';
import { CakeEditorComponent } from './cake-editor/cake-editor.component';

export const routes: Routes = [
  { path: 'cake-editor', component: CakeEditorComponent },
  { path: '**', redirectTo: 'cake-editor' }

];
