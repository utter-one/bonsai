/**
 * Parses an integer environment variable, falling back to the given default
 * if the variable is missing, non-numeric, zero, or negative.
 */
export function parseEnvInt(key: string, defaultValue: number): number {
  const value = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}
