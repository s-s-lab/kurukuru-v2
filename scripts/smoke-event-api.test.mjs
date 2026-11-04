// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const smokeScript = fileURLToPath(new URL('./smoke-event-api.mjs', import.meta.url));
const canary = 'synthetic-canary-edit-token-never-log-12345';

function runSmoke(malformedRequest = 0) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    let requests = 0;
    let event;
    let answer;
    const editToken = ${JSON.stringify(canary)};
    globalThis.fetch = async (url, options = {}) => {
      requests += 1;
      const status = requests < 6 ? (requests === 3 ? 409 : 201) : 200;
      if (requests === ${malformedRequest}) {
        return new Response('{"editToken":"' + editToken + '","incomplete":', { status });
      }
      const path = new URL(url).pathname;
      const body = options.body && JSON.parse(options.body);
      if (path.endsWith('/events') && options.method === 'POST') {
        event ??= { id: 'event-smoke', title: body.title, candidateSlots: [{ id: 'a' }, { id: 'b' }] };
        return Response.json(requests === 3 ? { code: 'IDEMPOTENCY_KEY_REUSED' } : { event }, { status });
      }
      if (options.method === 'POST') {
        answer ??= { id: 'answer-smoke', ...body };
        return Response.json({ response: answer, editToken }, { status });
      }
      if (options.method === 'PATCH') {
        answer = { ...answer, ...body };
        return Response.json({ response: answer }, { status });
      }
      return Response.json({ ...event, responses: [answer] }, { status });
    };
    await import(${JSON.stringify(smokeScript)});
  `], {
    env: { ...process.env, FUNCTION_URL: 'https://smoke.invalid' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  return result;
}

describe('smoke JSON diagnostics', () => {
  it.each([
    ['response create', 4, 201],
    ['response replay', 5, 201],
    ['public GET', 6, 200],
    ['response PATCH', 7, 200],
    ['public GET after PATCH', 8, 200],
  ])('never logs malformed %s body content', (_stage, request, status) => {
    const result = runSmoke(request);
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain(`Expected JSON (${status})`);
    expect(output).not.toContain(canary);
    expect(output).not.toContain('editToken');
    expect(output).not.toContain('incomplete');
  });

  it('keeps the successful smoke flow and output free of the edit token', () => {
    const result = runSmoke();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      responseCreateStatus: 201,
      responseReplayStatus: 201,
      updateStatus: 200,
      publicSecretChecks: true,
    });
    expect(result.stdout + result.stderr).not.toContain(canary);
  });
});
