export type CompletionVerdict = 'complete' | 'incomplete' | 'ambiguous';

/**
 * Determines whether a recognized utterance is likely a complete thought or mid-speech,
 * using fast local heuristics. No external calls — runs in <1ms.
 *
 * - "complete": process immediately
 * - "incomplete": keep listening
 * - "ambiguous": defer to debounce timer
 */
export class SpeechCompletionDetector {
  /**
   * Analyze a recognized text fragment and return a completion verdict.
   */
  public analyze(text: string): CompletionVerdict {
    if (!text || !text.trim()) {
      return 'ambiguous';
    }

    const normalized = text.trim().toLowerCase();

    if (this.isCompletePunctuation(normalized)) {
      return 'complete';
    }

    if (this.isIncompleteEnding(normalized)) {
      return 'incomplete';
    }

    if (this.isCompleteDiscourseMarker(normalized)) {
      return 'complete';
    }

    if (this.isTrailingFiller(normalized)) {
      return 'incomplete';
    }

    if (this.isSentenceFragment(normalized)) {
      return 'incomplete';
    }

    return 'ambiguous';
  }

  /** Ends with terminal punctuation (. ! ?) possibly followed by closing quote/paren. */
  private isCompletePunctuation(text: string): boolean {
    return /[.!?]['")\u201D\u2019]?$/u.test(text);
  }

  /** Ends with a conjunction, coordinating word, or trailing preposition. */
  private isIncompleteEnding(text: string): boolean {
    const lastWord = this.getLastWord(text);
    if (!lastWord) return false;

    const conjunctions = new Set([
      'and', 'but', 'or', 'so', 'yet', 'nor', 'because', 'although',
      'though', 'while', 'unless', 'until', 'since', 'if', 'when',
      'where', 'whether', 'as',
    ]);

    const trailingPrepositions = new Set([
      'to', 'for', 'with', 'from', 'in', 'on', 'at', 'by', 'about',
      'into', 'onto', 'over', 'under', 'through', 'between', 'around',
      'without', 'before', 'after', 'during',
    ]);

    return conjunctions.has(lastWord) || trailingPrepositions.has(lastWord);
  }

  /** Ends with a known discourse closure marker. */
  private isCompleteDiscourseMarker(text: string): boolean {
    const lastWord = this.getLastWord(text);
    if (!lastWord) return false;

    const closers = new Set([
      'okay', 'ok', 'thanks', 'thank', 'got', 'right', 'sure', 'alright',
      'fine', 'perfect', 'done', 'yes', 'no', 'yeah', 'yep', 'nah', 'nope',
    ]);

    return closers.has(lastWord);
  }

  /** Ends with a filler word that suggests the user is still thinking. */
  private isTrailingFiller(text: string): boolean {
    const lastWord = this.getLastWord(text);
    if (!lastWord) return false;

    const fillers = new Set(['um', 'uh', 'like', 'erm', 'ah', 'well', 'so']);

    return fillers.has(lastWord);
  }

  /** Detects likely sentence fragments: single word, or very short without verb-like structure. */
  private isSentenceFragment(text: string): boolean {
    const words = text.split(/\s+/);
    if (words.length <= 1) {
      return false;
    }
    if (words.length <= 2) {
      const lastWord = this.getLastWord(text);
      const verbs = new Set([
        'is', 'are', 'was', 'were', 'have', 'has', 'do', 'does', 'did',
        'can', 'could', 'will', 'would', 'should', 'may', 'might', 'need',
        'want', 'think', 'know', 'see', 'get', 'go', 'come', 'make', 'take',
      ]);
      if (!verbs.has(lastWord)) {
        return true;
      }
    }
    return false;
  }

  private getLastWord(text: string): string {
    const cleaned = text.replace(/[^\w\s'-]/g, '').trim();
    const words = cleaned.split(/\s+/);
    return words[words.length - 1]?.toLowerCase() || '';
  }
}
