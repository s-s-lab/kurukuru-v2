import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.KURUKURU_TOKEN_SECRET ??= 'test-only-function-bundle-secret-32-characters';

const source = await readFile(new URL('../dist-function/index.mjs', import.meta.url), 'utf8');
if (/\bfrom\s+["']pg["']|import\(["']pg["']\)/.test(source)) {
  throw new Error('Function bundle must include pg instead of importing it from an absent runtime package.');
}

const module = await import('../dist-function/index.mjs');
const response = await module.default.request('/api/v1/health');
const body = await response.json();

if (
  response.status !== 200 ||
  body.status !== 'ok' ||
  body.service !== 'kurukuru-api'
) {
  throw new Error(`Function bundle health check failed: ${JSON.stringify(body)}`);
}

console.log(JSON.stringify(body));
