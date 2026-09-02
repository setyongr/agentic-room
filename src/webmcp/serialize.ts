/**
 * Compact JSON/error serialization and runtime argument validation for the
 * WebMCP tool surface.
 *
 * Every tool result is the JSON string of a concise payload:
 *
 *   {success:true, ...data}                  on success
 *   {success:false, error, code, ...details} on failure
 *
 * The validators guard tool inputs at runtime: the host parses the argument
 * JSON before `execute` runs, but the values still need primitive/object/
 * string/number/enum/array checks so every tool fails with a structured,
 * actionable error instead of throwing or trusting malformed input.
 */

/** Outcome of reading a tool argument: the typed value, or a structured failure. */
export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

/** Build a successful tool payload — `{success:true, ...data}` — as compact JSON. */
export function toolOk(data?: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ success: true, ...data });
}

/** Build a failed tool payload — `{success:false, error, code, ...details}` — as compact JSON. */
export function toolFail(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify({ success: false, error: message, code, ...details });
}

/* ------------------------------------------------------------------ */
/* Runtime predicates                                                  */
/* ------------------------------------------------------------------ */

/** True for plain objects (not arrays, not null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True for finite numbers (rejects NaN, Infinity, and non-numbers). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True for strings. */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** True for booleans. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/** True for arrays of strings. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/* ------------------------------------------------------------------ */
/* Field readers                                                       */
/* ------------------------------------------------------------------ */

/** A structured failure value, narrowed to the failing branch of ReadResult. */
function fail(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

/** Compact description of a value's shape for error messages. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** Read the tool input as a plain object of arguments. */
export function readObjectInput(input: unknown): ReadResult<Record<string, unknown>> {
  return isPlainObject(input)
    ? { ok: true, value: input }
    : fail('invalid_args', `Tool arguments must be a JSON object, got ${describeValue(input)}`);
}

/** Read `key` as a string; fails when absent. */
export function readRequiredString(
  args: Readonly<Record<string, unknown>>,
  key: string,
  options: { maxLength?: number } = {},
): ReadResult<string> {
  const raw = args[key];
  if (raw === undefined) return fail('invalid_args', `Argument "${key}" is required`);
  if (!isString(raw)) {
    return fail('invalid_args', `Argument "${key}" must be a string, got ${describeValue(raw)}`);
  }
  if (options.maxLength !== undefined && raw.length > options.maxLength) {
    return fail(
      'invalid_args',
      `Argument "${key}" must be at most ${options.maxLength} characters`,
    );
  }
  return { ok: true, value: raw };
}

/** Read `key` as a string; undefined when absent. */
export function readOptionalString(
  args: Readonly<Record<string, unknown>>,
  key: string,
  options: { maxLength?: number } = {},
): ReadResult<string | undefined> {
  const raw = args[key];
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isString(raw)) {
    return fail('invalid_args', `Argument "${key}" must be a string, got ${describeValue(raw)}`);
  }
  if (options.maxLength !== undefined && raw.length > options.maxLength) {
    return fail(
      'invalid_args',
      `Argument "${key}" must be at most ${options.maxLength} characters`,
    );
  }
  return { ok: true, value: raw };
}

/** Read `key` as a finite number; fails when absent. */
export function readRequiredNumber(
  args: Readonly<Record<string, unknown>>,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): ReadResult<number> {
  const raw = args[key];
  if (raw === undefined) return fail('invalid_args', `Argument "${key}" is required`);
  const value = readNumberValue(raw, key, options);
  if (!value.ok) return value;
  return { ok: true, value: value.value };
}

/** Read `key` as a finite number; undefined when absent. */
export function readOptionalNumber(
  args: Readonly<Record<string, unknown>>,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): ReadResult<number | undefined> {
  const raw = args[key];
  if (raw === undefined) return { ok: true, value: undefined };
  return readNumberValue(raw, key, options);
}

/** Shared number validation: finite, optional integer and bounds checks. */
function readNumberValue(
  raw: unknown,
  key: string,
  options: { min?: number; max?: number; integer?: boolean },
): ReadResult<number> {
  if (!isFiniteNumber(raw)) {
    return fail('invalid_args', `Argument "${key}" must be a finite number, got ${describeValue(raw)}`);
  }
  if (options.integer === true && !Number.isInteger(raw)) {
    return fail('invalid_args', `Argument "${key}" must be an integer`);
  }
  if (options.min !== undefined && raw < options.min) {
    return fail('invalid_args', `Argument "${key}" must be at least ${options.min}`);
  }
  if (options.max !== undefined && raw > options.max) {
    return fail('invalid_args', `Argument "${key}" must be at most ${options.max}`);
  }
  return { ok: true, value: raw };
}

/** Read `key` as a boolean; undefined when absent. */
export function readOptionalBoolean(
  args: Readonly<Record<string, unknown>>,
  key: string,
): ReadResult<boolean | undefined> {
  const raw = args[key];
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isBoolean(raw)) {
    return fail('invalid_args', `Argument "${key}" must be a boolean, got ${describeValue(raw)}`);
  }
  return { ok: true, value: raw };
}

/** Read `key` as an array of strings; undefined when absent. */
export function readOptionalStringArray(
  args: Readonly<Record<string, unknown>>,
  key: string,
  options: { maxLength?: number } = {},
): ReadResult<string[] | undefined> {
  const raw = args[key];
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isStringArray(raw)) {
    return fail(
      'invalid_args',
      `Argument "${key}" must be an array of strings, got ${describeValue(raw)}`,
    );
  }
  if (options.maxLength !== undefined && raw.length > options.maxLength) {
    return fail(
      'invalid_args',
      `Argument "${key}" must contain at most ${options.maxLength} entries`,
    );
  }
  return { ok: true, value: raw };
}

/** Read `key` as one of `allowed`; fails when absent. */
export function readRequiredEnum<T extends string>(
  args: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): ReadResult<T> {
  const raw = args[key];
  if (raw === undefined) return fail('invalid_args', `Argument "${key}" is required`);
  const value = readEnumValue(raw, key, allowed);
  if (!value.ok) return value;
  return { ok: true, value: value.value };
}

/** Read `key` as one of `allowed`; undefined when absent. */
export function readOptionalEnum<T extends string>(
  args: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): ReadResult<T | undefined> {
  const raw = args[key];
  if (raw === undefined) return { ok: true, value: undefined };
  return readEnumValue(raw, key, allowed);
}

/** Shared enum validation against a fixed list of allowed strings. */
function readEnumValue<T extends string>(
  raw: unknown,
  key: string,
  allowed: readonly T[],
): ReadResult<T> {
  if (!isString(raw)) {
    return fail('invalid_args', `Argument "${key}" must be a string, got ${describeValue(raw)}`);
  }
  if (!allowed.includes(raw as T)) {
    return fail('invalid_args', `Argument "${key}" must be one of: ${allowed.join(', ')}`);
  }
  return { ok: true, value: raw as T };
}
