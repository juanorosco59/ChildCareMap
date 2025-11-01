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
  preview: {
    allowedHosts: ['joyful-playfulness-production-1974.up.railway.app'],
    host: '0.0.0.0',
    port: process.env.PORT || 4173
  }
})