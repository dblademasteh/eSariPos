export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function toUpdate(body, mapping) {
  const assignments = [];
  const values = [];
  for (const [key, column] of Object.entries(mapping)) {
    if (body[key] !== undefined) {
      values.push(body[key]);
      assignments.push(`${column} = $${values.length}`);
    }
  }
  return assignments.length ? { assignments, values } : null;
}
