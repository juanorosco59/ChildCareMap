// vite.config.js
import { defineConfig } from 'vite';

//
//
//export default defineConfig({
//  root: 'web',
//  server: {
//    port: 8080, // puedes cambiarlo si quieres
//  }
//});
//
//

export default defineConfig({
  root: 'web',
  preview: {
    allowedHosts: ['childcaremap-capafrontendqa.up.railway.app'],
    host: '0.0.0.0',
    port: process.env.PORT || 4173
  }
})

