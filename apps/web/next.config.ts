import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Transpila os pacotes de workspace consumidos a partir do código-fonte TS.
  transpilePackages: ['@nutrimed/shared-types', '@nutrimed/domain'],
};

export default nextConfig;
