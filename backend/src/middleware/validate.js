// Request validation with zod. Parsed (coerced, trimmed) values replace the
// raw input so controllers only ever see validated data.
import { HttpError } from '../utils/errors.js';

export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    const issues = [];
    const run = (schema, value, where) => {
      if (!schema) return value;
      const result = schema.safeParse(value ?? {});
      if (!result.success) {
        for (const i of result.error.issues) {
          issues.push({ field: [where, ...i.path].join('.'), message: i.message });
        }
        return value;
      }
      return result.data;
    };
    const parsedBody = run(body, req.body, 'body');
    const parsedQuery = run(query, req.query, 'query');
    const parsedParams = run(params, req.params, 'params');
    if (issues.length) {
      return next(new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', issues));
    }
    req.valid = { body: parsedBody, query: parsedQuery, params: parsedParams };
    return next();
  };
}
