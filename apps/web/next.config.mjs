/**
 * Deux cibles de déploiement, une seule configuration.
 *
 *  - Par défaut : serveur Next classique (`next start`), pour le développement.
 *  - `NEXT_OUTPUT=export` : site 100 % statique — la cible réelle, puisqu'il
 *    n'y a rien d'autre à déployer.
 *
 * `NEXT_PUBLIC_BASE_PATH` sert au cas où le site vit dans un sous-dossier,
 * ce qui est le cas d'un dépôt GitHub Pages : `/nom-du-depot`.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const isExport = process.env.NEXT_OUTPUT === 'export';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Les deux paquets sont consommés en TypeScript source : pas d'étape de build
  // intermédiaire, donc aucun risque que les écrans et le moteur divergent sur
  // un type ou une constante.
  transpilePackages: ['@identite-secrete/shared', '@identite-secrete/engine'],

  ...(isExport ? { output: 'export' } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),

  // Chaque page devient un dossier avec son `index.html` : c'est ce qu'un
  // hébergement de fichiers statiques sait servir sans configuration.
  trailingSlash: true,

  // Aucun serveur pour optimiser les images à la volée.
  images: { unoptimized: true },
};

export default nextConfig;
