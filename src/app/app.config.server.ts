import { importProvidersFrom, mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { HttpClientModule } from '@angular/common/http';
import { appConfig } from './app.config'; 

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    importProvidersFrom(HttpClientModule)
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
