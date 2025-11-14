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

//export default defineConfig({
//  preview: {
//    allowedHosts: ['childcaremap-capafrontend.up.railway.app'],
//    host: '0.0.0.0',
//    port: process.env.PORT || 4173
//  }
//})

export default {
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        login: 'login.html',
      }
    }
  }
}