/** Expected conflict when a queue action would interrupt an active render. */
export class JobHistoryConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "JobHistoryConflictError";
  }
}
