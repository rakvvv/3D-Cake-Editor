const apiBaseUrl =
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ??
  'http://localhost:8080/api';

export const environment = {
  production: false,
  apiBaseUrl,
  authorMode: true,
  endpoints: {
    saveScene: 'saveScene',
    scene: 'scene',
    decorations: 'decorations'
  }
};
