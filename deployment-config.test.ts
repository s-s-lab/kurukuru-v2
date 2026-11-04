import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import viteConfig from './vite.config';

describe('GitHub Pages deployment configuration', () => {
  it('builds assets from the root of the custom domain', () => {
    expect(viteConfig).toMatchObject({ base: '/' });
  });

  it('deploys the Vite build to Pages with the development API endpoint', () => {
    const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');

    expect(workflow).toContain('actions/configure-pages@v5');
    expect(workflow).toContain('actions/upload-pages-artifact@v4');
    expect(workflow).toContain('actions/deploy-pages@v4');
    expect(workflow).toContain('path: dist');
    expect(workflow).toContain(
      'VITE_API_BASE_URL: https://br-icy-dew-aowwun6d-kurukuruapi.compute.c-2.ap-southeast-1.aws.neon.tech/api/v1',
    );
  });
});
