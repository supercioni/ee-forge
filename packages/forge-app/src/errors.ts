/**
 * A failure a caller should see as an answer, not a crash: carries the HTTP-style status
 * and, for validation failures, the offending document path. Transports map it to their
 * own error shape.
 */
export class ForgeServiceError extends Error {
  override readonly name = "ForgeServiceError";
  constructor(
    message: string,
    readonly status: number,
    readonly path: string | null = null,
  ) {
    super(message);
  }
}

export const notFound = (message: string, path: string | null = null): ForgeServiceError =>
  new ForgeServiceError(message, 404, path);
export const badRequest = (message: string, path: string | null = null): ForgeServiceError =>
  new ForgeServiceError(message, 400, path);
export const unprocessable = (message: string, path: string | null = null): ForgeServiceError =>
  new ForgeServiceError(message, 422, path);
