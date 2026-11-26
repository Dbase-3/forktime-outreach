// Validates a request body against a zod schema; a failure is a 422 listing
// each problem by path, so a form can point at the field.

import type { ZodType } from "zod";
import { unprocessable } from "./errors";

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw unprocessable(
      "Some of that isn't valid.",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
