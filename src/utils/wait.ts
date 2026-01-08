/**
 * Utility function to wait for a specified duration
 * @param ms - The number of milliseconds to wait
 * @returns Promise that resolves after the specified duration
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
