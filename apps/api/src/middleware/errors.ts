import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message }, requestId: req.requestId });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: {
      code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.',
      fields: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message }))
    }, requestId: req.requestId });
    return;
  }
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  if (status === 400 || status === 413 || status === 415) {
    res.status(status).json({ error: { code: 'INVALID_BODY', message: 'The request body is invalid or too large.' }, requestId: req.requestId });
    return;
  }
  console.error(`Unexpected API error; requestId=${req.requestId}`);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' }, requestId: req.requestId });
};
