import { logger } from '../../../utils/logger';
import { wait } from '../../../utils/wait';

/**
 * Callback function that is invoked when a complete sentence is detected
 * @param sentence The complete sentence text
 * @returns Promise<boolean> that resolves to true if the sentence was successfully processed, false otherwise
 */
export type SentenceCallback = (sentence: string) => Promise<boolean>;

/**
 * Utility class that splits streaming text into complete sentences
 * Buffers incoming text and detects sentence boundaries to send complete sentences
 * to a callback function for processing. Includes sophisticated sentence detection
 * with abbreviation handling and retry logic.
 * 
 * NOTE: This works best with English text and may need adjustments for other languages.
 */
export class SentenceSplitter {
  /** Buffer for accumulating text until a sentence boundary is found */
  private buffer: string = '';

  /** Callback function to invoke when a complete sentence is detected */
  private readonly callback: SentenceCallback;

  /** Pre-compiled regex for better performance */
  private static readonly SENTENCE_REGEX = /[.!?]+(?:\s+|$)/g;

  /** Common abbreviations that shouldn't trigger sentence breaks */
  private static readonly ABBREVIATIONS = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'vs', 'etc', 'inc', 'ltd', 'corp', 'jr', 'sr', 'phd', 'md', 'ba', 'ma', 'am', 'pm', 'st', 'ave', 'blvd']);

  /**
   * Creates a new SentenceSplitter instance
   * @param callback Callback function that receives complete sentences and returns true if successfully processed
   */
  constructor(callback: SentenceCallback) {
    this.callback = callback;
  }

  /**
   * Checks if the buffer is empty
   * @returns True if buffer has no content, false otherwise
   */
  isEmpty(): boolean {
    return this.buffer.trim().length === 0;
  }

  /**
   * Adds text to the splitter buffer and processes any complete sentences
   * Detects sentence boundaries and invokes the callback for each complete sentence found
   * @param text The text to add to the buffer
   * @returns Promise that resolves when all complete sentences have been processed
   */
  async addText(text: string): Promise<void> {
    if (!text) return;

    this.buffer += text;
    await this.processCompleteSentences();
  }

  /**
   * Finalizes the splitter by processing any remaining text in the buffer
   * Should be called when no more text will be added to ensure all text is processed
   * @returns Promise that resolves when the remaining buffer has been processed
   */
  async finalize(): Promise<void> {
    const remaining = this.buffer.trim();
    if (remaining) {
      await this.callback(remaining);
      this.buffer = '';
    }
  }

  /**
   * Clears the internal buffer without processing remaining text
   * Useful for resetting the splitter state
   */
  clear(): void {
    this.buffer = '';
  }

  /**
   * Resets the internal state (alias for clear)
   */
  reset(): void {
    this.buffer = '';
  }

  /**
   * Gets the current buffer content without processing it
   * @returns The current buffered text
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Process and extract complete sentences from the buffer
   * Optimized for performance and better sentence detection with abbreviation handling
   */
  private async processCompleteSentences(): Promise<void> {
    let lastIndex = 0;

    // Reset regex state
    SentenceSplitter.SENTENCE_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = SentenceSplitter.SENTENCE_REGEX.exec(this.buffer)) !== null) {
      const potentialSentence = this.buffer.substring(lastIndex, match.index + match[0].length).trim();

      if (potentialSentence && this.isValidSentenceEnd(potentialSentence, match.index)) {
        logger.debug(`Sentence splitter detected complete sentence: "${potentialSentence}"`);
        const callbackResult = await this.callback(potentialSentence);
        // If callback fails, retry after a short wait
        if (!callbackResult) {
          await wait(10);
          continue;
        }
        lastIndex = match.index + match[0].length;
      }
    }

    // Update buffer with remaining text
    if (lastIndex > 0) {
      this.buffer = this.buffer.substring(lastIndex);
    }
  }

  /**
   * Check if a potential sentence ending is valid (not an abbreviation or numeric pattern)
   * @param sentence The potential sentence text
   * @param punctuationIndex The index of the punctuation mark in the buffer
   * @returns True if this is a valid sentence ending, false otherwise
   */
  private isValidSentenceEnd(sentence: string, punctuationIndex: number): boolean {
    // Find the word before the punctuation
    const beforePunctuation = this.buffer.substring(0, punctuationIndex);
    const lastWordMatch = beforePunctuation.match(/\b(\w+)$/);

    if (!lastWordMatch) return true;

    const lastWord = lastWordMatch[1].toLowerCase();

    // Check if it's a known abbreviation
    if (SentenceSplitter.ABBREVIATIONS.has(lastWord)) {
      return false;
    }

    // Single letter followed by period (likely initial)
    if (lastWord.length === 1 && this.buffer[punctuationIndex] === '.') {
      return false;
    }

    // Check for numeric patterns (e.g., "3.14")
    if (/\d$/.test(lastWord) && this.buffer[punctuationIndex] === '.') {
      const nextChar = this.buffer[punctuationIndex + 1];
      if (nextChar && /\d/.test(nextChar)) {
        return false;
      }
    }

    return true;
  }
}
