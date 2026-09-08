/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `packages/shared` est consommé en TypeScript source : pas d'étape de build
  // intermédiaire, donc pas de risque de désynchronisation client/serveur.
  transpilePackages: ['@identite-secrete/shared'],
};

export default nextConfig;
