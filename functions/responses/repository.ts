export type {
  CreateResponsePersistenceInput,
  ResponseRepository,
  UpdateResponsePersistenceInput,
} from './service';
export { IdempotencyConflictError } from '../events/postgres-event-repository';

export class EventNotFoundError extends Error {
  constructor() {
    super('The event was not found.');
    this.name = 'EventNotFoundError';
  }
}

export class EventClosedError extends Error {
  constructor() {
    super('The event is not accepting responses.');
    this.name = 'EventClosedError';
  }
}

export class InvalidAvailabilityError extends Error {
  constructor() {
    super('Availability must include each event candidate slot exactly once.');
    this.name = 'InvalidAvailabilityError';
  }
}

export class ResponseNotFoundError extends Error {
  constructor() {
    super('The response was not found.');
    this.name = 'ResponseNotFoundError';
  }
}
