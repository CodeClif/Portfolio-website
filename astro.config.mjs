import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [mdx()],
  site: 'https://codeclif.github.io',
  base: '/Portfolio-website',
  trailingSlash: 'always'
});
