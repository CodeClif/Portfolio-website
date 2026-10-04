import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

const isIpfs = process.env.DEPLOY_TARGET === 'ipfs';

export default defineConfig({
  integrations: [mdx()],
  site: process.env.SITE_URL || 'https://codeclif.github.io',
  base: isIpfs ? '/' : '/Portfolio-website',
  trailingSlash: 'always',
  // Keep Astro 6's HTML-aware whitespace so spaces between inline elements survive.
  compressHTML: true
});
