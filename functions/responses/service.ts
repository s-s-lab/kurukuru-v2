import type { AvailabilityMark, PublicResponse } from '../events/service';

export type ResponseRequest = {
  displayName: string;
  comment: string;
  availability: Array<{
    candidateSlotId: string;
    mark: AvailabilityMark;
  }>;
};

export type CreateResponseCommand = {
  eventId: string;
  idempotencyKey: string;
  request: ResponseRequest;
};

export type UpdateResponseCommand = {
  responseId: string;
  editToken: string;
  request: ResponseRequest;
};

export type UpdateResponseResult = { response: PublicResponse };
export type CreateResponseResult = UpdateResponseResult & { editToken: string };

export interface ResponseService {
  createResponse(command: CreateResponseCommand): Promise<CreateResponseResult>;
  updateResponse(command: UpdateResponseCommand): Promise<UpdateResponseResult>;
}

export type CreateResponsePersistenceInput = CreateResponseCommand & {
  responseId: string;
  requestHash: string;
  editTokenHash: string;
};

export type UpdateResponsePersistenceInput = Omit<UpdateResponseCommand, 'editToken'> & {
  editTokenHash: string;
};

// Persistence receives data only; edit tokens and the signing secret stay in the service.
export interface ResponseRepository {
  createResponse(input: CreateResponsePersistenceInput): Promise<UpdateResponseResult>;
  updateResponse(input: UpdateResponsePersistenceInput): Promise<UpdateResponseResult>;
}
