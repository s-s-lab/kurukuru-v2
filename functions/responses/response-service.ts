import { createHash, randomUUID } from 'node:crypto';

import { deriveResponseEditToken, hashOpaqueToken } from '../security/secrets';
import type { ResponseRepository, ResponseService } from './service';
import { responseRequestSchema } from './validation';

type ResponseServiceDependencies = {
  generateResponseId: () => string;
};

export function createResponseService(
  repository: ResponseRepository,
  tokenSecret: string,
  dependencyOverrides: Partial<ResponseServiceDependencies> = {},
): ResponseService {
  const dependencies = { generateResponseId: randomUUID, ...dependencyOverrides };

  return {
    async createResponse(command) {
      const request = responseRequestSchema.parse(command.request);
      const responseId = dependencies.generateResponseId();
      const result = await repository.createResponse({
        eventId: command.eventId,
        idempotencyKey: command.idempotencyKey,
        responseId,
        request,
        requestHash: createHash('sha256').update(JSON.stringify(request), 'utf8').digest('hex'),
        editTokenHash: hashOpaqueToken(deriveResponseEditToken(tokenSecret, responseId)),
      });
      // A replay may return an earlier ID instead of the proposed new ID.
      return {
        response: result.response,
        editToken: deriveResponseEditToken(tokenSecret, result.response.id),
      };
    },

    async updateResponse(command) {
      return repository.updateResponse({
        responseId: command.responseId,
        request: responseRequestSchema.parse(command.request),
        editTokenHash: hashOpaqueToken(command.editToken),
      });
    },
  };
}
