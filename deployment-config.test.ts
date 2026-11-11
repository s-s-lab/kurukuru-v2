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

  it('publishes the application when main is updated', () => {
    const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');

    expect(workflow).toContain('push:');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).not.toContain('Replace public site with temporary suspension page');
    expect(workflow).not.toContain('Disallow: /');
  });

  it('documents the custom domain as an allowed browser origin', () => {
    const exampleEnvironment = readFileSync('.env.example', 'utf8');

    expect(exampleEnvironment).toContain('KURUKURU_ALLOWED_ORIGINS=https://kurukuru-app.jp');
  });
});
