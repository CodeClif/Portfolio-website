import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

const isIpfs = process.env.DEPLOY_TARGET === 'ipfs';

export default defineConfig({
  integrations: [mdx()],
  site: process.env.SITE_URL || 'https://codeclif.github.io',
  base: isIpfs ? '/' : '/Portfolio-website',
  trailingSlash: 'always',
  // Keep Astro 6's HTML-aware whitespace so spaces between inline elements survive.
  compressHTML: true,
  // Ship CSS inside each page. On IPFS gateways like eth.limo, a stale cache can
  // serve a new page with an old build's assets, so a separate stylesheet 404s.
  build: { inlineStylesheets: 'always' }
});
