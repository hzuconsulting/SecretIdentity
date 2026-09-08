/**
 * Deux cibles de déploiement, une seule configuration.
 *
 *  - Par défaut : serveur Next classique (Vercel, `next start`).
 *  - `NEXT_OUTPUT=export` : site 100 % statique, déployable sur GitHub Pages.
 *
 * `NEXT_PUBLIC_BASE_PATH` sert au cas où le site vit dans un sous-dossier,
 * ce qui est le cas d'un dépôt GitHub Pages : `/nom-du-depot`.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const isExport = process.env.NEXT_OUTPUT === 'export';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `packages/shared` est consommé en TypeScript source : pas d'étape de build
  // intermédiaire, donc pas de risque de désynchronisation client/serveur.
  transpilePackages: ['@identite-secrete/shared'],

  ...(isExport ? { output: 'export' } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),

  // Chaque page devient un dossier avec son `index.html` : c'est ce qu'un
  // hébergement de fichiers statiques sait servir sans configuration.
  trailingSlash: true,

  // Pas de serveur pour optimiser les images à la volée en mode statique.
  images: { unoptimized: true },
};

export default nextConfig;
