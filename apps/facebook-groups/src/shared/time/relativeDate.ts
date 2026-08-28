export type RelativeDateLocale = 'en' | 'fr';

export type RelativeDateResult = {
  publishedAt: string | null;
  warning: 'UNPARSED_DATE' | null;
};

type RelativePattern = {
  regex: RegExp;
  resolve: (match: RegExpMatchArray, referenceDate: Date) => Date;
};

const SECOND_IN_MILLISECONDS = 1_000;
const MINUTE_IN_MILLISECONDS = 60 * SECOND_IN_MILLISECONDS;
const HOUR_IN_MILLISECONDS = 60 * MINUTE_IN_MILLISECONDS;
const DAY_IN_MILLISECONDS = 24 * HOUR_IN_MILLISECONDS;
const WEEK_IN_MILLISECONDS = 7 * DAY_IN_MILLISECONDS;
const MONTH_IN_MILLISECONDS = 30 * DAY_IN_MILLISECONDS;
const YEAR_IN_MILLISECONDS = 365 * DAY_IN_MILLISECONDS;

function subtractTime(
  referenceDate: Date,
  value: number,
  unitInMilliseconds: number,
): Date {
  return new Date(referenceDate.getTime() - value * unitInMilliseconds);
}

const englishPatterns: RelativePattern[] = [
  {
    regex: /^just now$/i,
    resolve: (_match, referenceDate) => new Date(referenceDate),
  },
  {
    regex: /^a few seconds ago$/i,
    resolve: (_match, referenceDate) =>
      subtractTime(referenceDate, 30, SECOND_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*seconds?\s*ago$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), SECOND_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*s$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), SECOND_IN_MILLISECONDS),
  },
  {
    regex: /^a minute ago$/i,
    resolve: (_match, referenceDate) =>
      subtractTime(referenceDate, 1, MINUTE_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*min(?:ute)?s?\s*ago$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), MINUTE_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*m$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), MINUTE_IN_MILLISECONDS),
  },
  {
    regex: /^about an hour ago$/i,
    resolve: (_match, referenceDate) =>
      subtractTime(referenceDate, 1, HOUR_IN_MILLISECONDS),
  },
  {
    regex: /^an hour ago$/i,
    resolve: (_match, referenceDate) =>
      subtractTime(referenceDate, 1, HOUR_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*h(?:our)?s?\s*ago$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), HOUR_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*h$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), HOUR_IN_MILLISECONDS),
  },
  {
    regex: /^a day ago$/i,
    resolve: (_match, referenceDate) =>
      subtractTime(referenceDate, 1, DAY_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*d(?:ay)?s?\s*ago$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), DAY_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*d$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), DAY_IN_MILLISECONDS),
  },
  {
    regex: /^a week ago$/i,
    resolve: (_match, referenceDate) =>
      subtractTime(referenceDate, 1, WEEK_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*weeks?\s*ago$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), WEEK_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*w$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), WEEK_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*months?\s*ago$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), MONTH_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*mo$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), MONTH_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*years?\s*ago$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), YEAR_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*y$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), YEAR_IN_MILLISECONDS),
  },
  {
    regex: /^yesterday(?:\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm))?$/i,
    resolve: (match, referenceDate) => {
      const date = subtractTime(referenceDate, 1, DAY_IN_MILLISECONDS);
      if (match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
        applyClockTime(date, Number(match[1]), Number(match[2]), match[3]);
      }
      return date;
    },
  },
];

const frenchPatterns: RelativePattern[] = [
  {
    regex: /^à l'instant$/i,
    resolve: (_match, referenceDate) => new Date(referenceDate),
  },
  {
    regex: /^il y a\s+(\d+)\s*secondes?$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), SECOND_IN_MILLISECONDS),
  },
  {
    regex: /^il y a\s+(\d+)\s*min(?:ute)?s?$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), MINUTE_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*min$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), MINUTE_IN_MILLISECONDS),
  },
  {
    regex: /^il y a\s+environ\s+une\s+heure$/i,
    resolve: (_match, referenceDate) =>
      subtractTime(referenceDate, 1, HOUR_IN_MILLISECONDS),
  },
  {
    regex: /^il y a\s+(\d+)\s*h(?:eure)?s?$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), HOUR_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*h$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), HOUR_IN_MILLISECONDS),
  },
  {
    regex: /^il y a\s+(\d+)\s*j(?:our)?s?$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), DAY_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*j$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), DAY_IN_MILLISECONDS),
  },
  {
    regex: /^il y a\s+une\s+semaine$/i,
    resolve: (_match, referenceDate) =>
      subtractTime(referenceDate, 1, WEEK_IN_MILLISECONDS),
  },
  {
    regex: /^il y a\s+(\d+)\s*semaines?$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), WEEK_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*sem$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), WEEK_IN_MILLISECONDS),
  },
  {
    regex: /^il y a\s+(\d+)\s*mois$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), MONTH_IN_MILLISECONDS),
  },
  {
    regex: /^(\d+)\s*mois$/i,
    resolve: (match, referenceDate) =>
      subtractTime(referenceDate, Number(match[1]), MONTH_IN_MILLISECONDS),
  },
  {
    regex: /^hier(?:\s+à\s+(\d{1,2})h(\d{2}))?$/i,
    resolve: (match, referenceDate) => {
      const date = subtractTime(referenceDate, 1, DAY_IN_MILLISECONDS);
      if (match[1] !== undefined && match[2] !== undefined) {
        date.setHours(Number(match[1]), Number(match[2]), 0, 0);
      }
      return date;
    },
  },
];

const localePatterns: Record<RelativeDateLocale, RelativePattern[]> = {
  en: englishPatterns,
  fr: frenchPatterns,
};

function applyClockTime(
  date: Date,
  hour: number,
  minute: number,
  meridiem: string,
): void {
  let normalizedHour = hour;

  if (meridiem.toLowerCase() === 'pm' && normalizedHour < 12) {
    normalizedHour += 12;
  }

  if (meridiem.toLowerCase() === 'am' && normalizedHour === 12) {
    normalizedHour = 0;
  }

  date.setHours(normalizedHour, minute, 0, 0);
}

function parseAbsoluteDate(rawValue: string, referenceDate: Date): Date | null {
  const normalized = rawValue.trim();
  if (/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }

  const date = new Date(parsed);
  if (date.getFullYear() < 2004) {
    return new Date(`${rawValue} ${String(referenceDate.getFullYear())}`);
  }

  return date;
}

export function parseRelativeDate(
  rawValue: string | null,
  referenceDate: Date,
  locale: RelativeDateLocale = 'en',
): RelativeDateResult {
  if (rawValue === null || rawValue.trim().length === 0) {
    return { publishedAt: null, warning: null };
  }

  const normalized = rawValue.trim();

  for (const pattern of localePatterns[locale]) {
    const match = pattern.regex.exec(normalized);
    if (match !== null) {
      return {
        publishedAt: pattern.resolve(match, referenceDate).toISOString(),
        warning: null,
      };
    }
  }

  const absoluteDate = parseAbsoluteDate(normalized, referenceDate);
  if (absoluteDate !== null && !Number.isNaN(absoluteDate.getTime())) {
    return {
      publishedAt: absoluteDate.toISOString(),
      warning: null,
    };
  }

  return {
    publishedAt: null,
    warning: 'UNPARSED_DATE',
  };
}

export function detectRelativeDateLocale(documentLanguage: string | undefined): RelativeDateLocale {
  if (documentLanguage?.toLowerCase().startsWith('fr') === true) {
    return 'fr';
  }

  return 'en';
}
