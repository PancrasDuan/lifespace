import { Temporal } from "@js-temporal/polyfill";
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
export function fail(message: string, code = "INVALID_COMMAND"): never {
  throw new DomainError(code, message);
}
export const day = (value: string) => {
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return fail("日期无效");
  }
};
export const cmp = (a: string, b: string) =>
  Temporal.PlainDate.compare(day(a), day(b));
export const add = (date: string, days: number) =>
  day(date).add({ days }).toString();
