import { NextFunction, Request, Response } from 'express';
import { AnyZodObject, ZodEffects } from 'zod';

type Schema = AnyZodObject | ZodEffects<AnyZodObject>;

interface ValidationSchemas {
  body?: Schema;
  params?: Schema;
  query?: Schema;
}

/**
 * Validates and replaces req.body/params/query with the parsed (and coerced) result,
 * so downstream handlers never touch raw, unvalidated client input.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (schemas.body) {
      req.body = schemas.body.parse(req.body);
    }
    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as typeof req.params;
    }
    if (schemas.query) {
      req.query = schemas.query.parse(req.query) as typeof req.query;
    }
    next();
  };
}
