process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.KURUKURU_TOKEN_SECRET ??= 'test-only-function-bundle-secret-32-characters';

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
