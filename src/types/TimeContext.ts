/**
 * A day entry in the upcoming calendar window.
 */
export type CalendarDay = {
  /** Date string in YYYY-MM-DD format, e.g. "2026-03-02" */
  date: string;
  /** Full weekday name, e.g. "Monday" */
  dayName: string;
  /** Abbreviated weekday name, e.g. "Mon" */
  dayNameShort: string;
  /** Full month name, e.g. "March" */
  month: string;
  /** Day of the month as a number, e.g. 2 */
  dayOfMonth: number;
  /** Whether this entry represents today */
  isToday: boolean;
};

/**
 * Rich time context injected into every prompt template as `{{time.*}}`.
 * All fields are pre-formatted in the conversation's resolved timezone so prompt
 * authors can reference them directly without any date arithmetic.
 *
 * Timezone precedence (resolved at conversation start):
 *   start_conversation.timezone > userProfile.timezone > project.timezone > UTC
 */
export type TimeContext = {
  // ── Current moment ──────────────────────────────────────────────────────────

  /** Full ISO 8601 timestamp, e.g. "2026-02-27T14:30:00.000+01:00" */
  iso: string;

  /** Unix epoch in milliseconds, e.g. 1772150200000 */
  timestamp: number;

  /** Date portion in YYYY-MM-DD format, e.g. "2026-02-27" */
  date: string;

  /** Time portion in HH:MM:SS format (24-hour), e.g. "14:30:00" */
  time: string;

  /** Combined date and time, e.g. "2026-02-27 14:30:00" */
  dateTime: string;

  /** Four-digit year string, e.g. "2026" */
  year: string;

  /** Zero-padded month string, e.g. "02" */
  month: string;

  /** Zero-padded day-of-month string, e.g. "27" */
  day: string;

  /** Zero-padded hour string (24-hour), e.g. "14" */
  hour: string;

  /** Zero-padded minute string, e.g. "30" */
  minute: string;

  /** Zero-padded second string, e.g. "00" */
  second: string;

  /** Full month name, e.g. "February" */
  monthName: string;

  /** Abbreviated month name, e.g. "Feb" */
  monthNameShort: string;

  /** Full weekday name, e.g. "Friday" */
  dayOfWeek: string;

  /** Abbreviated weekday name, e.g. "Fri" */
  dayOfWeekShort: string;

  /** IANA timezone identifier in use, e.g. "Europe/Warsaw" */
  timezone: string;

  /** UTC offset string, e.g. "+01:00" */
  offset: string;

  // ── Relative date grounding ──────────────────────────────────────────────────
  // These fields anchor the LLM to concrete dates when users refer to relative
  // or weekday-based expressions like "next Tuesday" or "this Friday".

  /** Date of the next (or current) Monday in YYYY-MM-DD, e.g. "2026-03-02" */
  nextMonday: string;
  /** Date of the next (or current) Tuesday in YYYY-MM-DD */
  nextTuesday: string;
  /** Date of the next (or current) Wednesday in YYYY-MM-DD */
  nextWednesday: string;
  /** Date of the next (or current) Thursday in YYYY-MM-DD */
  nextThursday: string;
  /** Date of the next (or current) Friday in YYYY-MM-DD */
  nextFriday: string;
  /** Date of the next (or current) Saturday in YYYY-MM-DD */
  nextSaturday: string;
  /** Date of the next (or current) Sunday in YYYY-MM-DD */
  nextSunday: string;

  /**
   * Upcoming 14-day calendar window starting from today. Each entry contains the
   * date, day name, and a flag marking today. Useful for structured date reasoning
   * or custom Handlebars rendering in templates.
   */
  calendar: CalendarDay[];

  /**
   * Pre-formatted natural-language anchor sentence for LLM grounding.
   * Drop `{{time.anchor}}` into any system prompt to eliminate date hallucinations.
   *
   * Example:
   * "Today is Friday, 27 February 2026 (Europe/Warsaw, UTC+01:00).
   *  This week (Mon–Sun): 23 Feb – 1 Mar. Next week: 2 Mar – 8 Mar.
   *  Next Mon: 2 Mar, Tue: 3 Mar, Wed: 4 Mar, Thu: 5 Mar, Fri: 6 Mar, Sat: 7 Mar, Sun: 8 Mar."
   */
  anchor: string;
};
