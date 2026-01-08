/**
 * Simple callback function for events that don't require parameters
 * @returns Promise that resolves when the callback processing is complete
 */
export type SimpleCallback = () => Promise<void>;

/**
 * Callback function for handling errors
 * @param error The error that occurred
 * @returns Promise that resolves when error handling is complete
 */
export type ErrorCallback = (error: Error) => Promise<void>;
