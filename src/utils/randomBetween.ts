/**
 * Returns a random integer in [min, max] inclusive.
 */
export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
