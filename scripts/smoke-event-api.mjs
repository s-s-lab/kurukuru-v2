import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { readJson } from './smoke-json.mjs';

const baseUrl = process.env.FUNCTION_URL?.replace(/\/$/, '');
if (!baseUrl) {
  throw new Error('FUNCTION_URL is required.');
}

const unique = randomUUID();
const idempotencyKey = `smoke-${unique}`;
const requestBody = {
  title: `Kurukuru API smoke ${unique}`,
  description: 'development Functionの自動検証データ',
  organizerEmail: `smoke+${unique}@example.com`,
  adminPassword: 'smoke-test-password-only',
  notifyOnResponse: true,
  candidateSlots: [
    { date: '2027-02-10', slotIndexes: [20, 21, 22] },
    { date: '2027-02-12', slotIndexes: [30, 31] },
  ],
};

async function createEvent(body, key) {
  const response = await fetch(`${baseUrl}/api/v1/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

const created = await createEvent(requestBody, idempotencyKey);
if (created.status !== 201 || !created.body.event?.id) {
  throw new Error(`Create failed: ${JSON.stringify(created)}`);
}

const replayed = await createEvent(requestBody, idempotencyKey);
if (replayed.status !== 201 || !isDeepStrictEqual(replayed.body, created.body)) {
  throw new Error(`Idempotent replay failed: ${JSON.stringify(replayed)}`);
}

const conflict = await createEvent(
  { ...requestBody, title: `${requestBody.title} changed` },
  idempotencyKey,
);
if (conflict.status !== 409 || conflict.body.code !== 'IDEMPOTENCY_KEY_REUSED') {
  throw new Error(`Idempotency conflict failed: ${JSON.stringify(conflict)}`);
}

const eventId = created.body.event.id;
const responseRequest = {
  displayName: 'Smoke participant',
  comment: 'development response flow',
  availability: created.body.event.candidateSlots.map(({ id }) => ({
    candidateSlotId: id,
    mark: 'best',
  })),
};
const responseKey = `smoke-response-${unique}`;

async function writeResponse(path, method, body, headers) {
  const response = await fetch(`${baseUrl}/api/v1/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

const answer = await writeResponse(`events/${eventId}/responses`, 'POST', responseRequest, {
  'idempotency-key': responseKey,
});
assert.equal(answer.status, 201, 'Response creation must succeed');
assert.ok(answer.body.response?.id, 'Response ID is required');
assert.ok(typeof answer.body.editToken === 'string' && answer.body.editToken.length === 43,
  'Response edit token is required');

const answerReplay = await writeResponse(`events/${eventId}/responses`, 'POST', responseRequest, {
  'idempotency-key': responseKey,
});
assert.equal(answerReplay.status, 201, 'Response replay must succeed');
assert.ok(answerReplay.body.response?.id === answer.body.response.id, 'Replay must retain response ID');
assert.ok(answerReplay.body.editToken === answer.body.editToken, 'Replay must retain edit token');
assert.ok(isDeepStrictEqual(answerReplay.body.response, answer.body.response),
  'Replay must retain response content');

function assertNoSecrets(body) {
  const serialized = JSON.stringify(body);
  for (const secret of [
    requestBody.organizerEmail,
    requestBody.adminPassword,
    answer.body.editToken,
  ]) {
    assert.ok(!serialized.includes(secret), 'Public response leaked a protected value');
  }
  // Covers camelCase and database-style keys, including nested public answers.
  assert.ok(!/edit[_]?token|secret[_]?hash|token[_]?hash|organizer[_]?email|admin[_]?password|notification[_]?outbox|delivery/i.test(serialized),
    'Public response leaked a protected field');
}

async function assertPublicAnswer(expected) {
  const response = await fetch(`${baseUrl}/api/v1/events/${eventId}`);
  const body = await readJson(response);
  assert.equal(response.status, 200, 'Public fetch must succeed');
  assert.equal(body.id, eventId, 'Public event ID must match');
  assert.equal(body.candidateSlots.length, responseRequest.availability.length);
  assert.equal(body.responses.length, 1, 'Replay must not duplicate an answer');
  assert.ok(isDeepStrictEqual(body.responses[0], expected), 'Public answer must reflect persisted content');
  assertNoSecrets(body);
  return { status: response.status, body };
}

assertNoSecrets(created.body);
const fetched = await assertPublicAnswer(answer.body.response);
function assertAvailability(actual, expected) {
  const ordered = (values) => [...values].sort((left, right) =>
    left.candidateSlotId.localeCompare(right.candidateSlotId));
  assert.ok(isDeepStrictEqual(ordered(actual), ordered(expected)),
    'Public availability must contain every expected slot and mark exactly once');
}
assertAvailability(fetched.body.responses[0].availability, responseRequest.availability);

const updateRequest = {
  ...responseRequest,
  availability: responseRequest.availability.map((slot, index) => ({
    ...slot,
    mark: index === 0 ? 'ng' : 'best',
  })),
};
const updated = await writeResponse(`responses/${answer.body.response.id}`, 'PATCH', updateRequest, {
  authorization: `Bearer ${answer.body.editToken}`,
});
assert.equal(updated.status, 200, 'Response update must succeed');
assert.ok(isDeepStrictEqual(Object.keys(updated.body), ['response']), 'PATCH must return only response');
assert.equal(updated.body.response.id, answer.body.response.id);
assertNoSecrets(updated.body);
const afterUpdate = await assertPublicAnswer(updated.body.response);
assertAvailability(afterUpdate.body.responses[0].availability, updateRequest.availability);

console.log(
  JSON.stringify({
    ok: true,
    eventId,
    responseId: answer.body.response.id,
    candidateSlotCount: fetched.body.candidateSlots.length,
    createStatus: created.status,
    replayStatus: replayed.status,
    conflictStatus: conflict.status,
    responseCreateStatus: answer.status,
    responseReplayStatus: answerReplay.status,
    getStatus: fetched.status,
    updateStatus: updated.status,
    getAfterUpdateStatus: afterUpdate.status,
    publicSecretChecks: true,
  }),
);
process.exit(0);
