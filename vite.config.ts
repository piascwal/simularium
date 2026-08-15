import { defineConfig } from 'vite';

// Site de projet GitHub Pages -> servi sous /simularium/, pas à la racine
// du domaine. Capacitor (empaquetage mobile) chargera dist/index.html
// depuis le système de fichiers de l'appareil et a besoin de chemins
// relatifs. D'où le split par mode plutôt qu'un base fixe.
export default defineConfig(({ mode }) => ({
  base: mode === 'capacitor' ? './' : '/simularium/',
  build: {
    outDir: 'dist',
  },
}));
