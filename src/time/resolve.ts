import { DateTime } from "luxon";
export type DateWindow = { from: string; to: string; label: string };
const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const monthPattern = months
  .map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`)
  .join("|");
const datePattern = `(?:20\\d{2}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?(?:\\s+(?:${monthPattern})(?:\\s+20\\d{2})?)?|(?:${monthPattern})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?)`;
const numbers = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];
function explicit(raw: string, time: DateTime, fallback?: DateTime) {
  if (!fallback?.isValid) fallback = undefined;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw))
    return DateTime.fromISO(raw, { zone: time.zoneName! });
  const match = raw.match(
    new RegExp(
      `^(?:(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(${monthPattern}))?|(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:,?\\s+(20\\d{2}))?$`,
    ),
  );
  if (!match) return null;
  const month = match[2] ?? match[3];
  if (!month && !fallback) return null;
  return DateTime.fromObject(
    {
      year: Number(match[5] ?? fallback?.year ?? time.year),
      month: month
        ? months.findIndex((m) => m.startsWith(month.slice(0, 3))) + 1
        : fallback!.month,
      day: Number(match[1] ?? match[4]),
    },
    { zone: time.zoneName! },
  );
}
function window(from: DateTime, through: DateTime): DateWindow | null {
  if (
    !from.isValid ||
    !through.isValid ||
    through.startOf("day") < from.startOf("day")
  )
    return null;
  from = from.startOf("day");
  through = through.startOf("day");
  return {
    from: from.toUTC().toISO()!,
    to: through.plus({ days: 1 }).toUTC().toISO()!,
    label: from.hasSame(through, "day")
      ? from.toFormat("d LLLL yyyy")
      : `${from.toFormat("d LLLL yyyy")} – ${through.toFormat("d LLLL yyyy")}`,
  };
}
export function resolveDate(
  text: string,
  timezone: string,
  clock = new Date(),
): DateWindow | null {
  let time = DateTime.fromJSDate(clock, { zone: timezone });
  if (!time.isValid) time = DateTime.fromJSDate(clock, { zone: "UTC" });
  const q = text.toLowerCase();
  // Resolve both endpoints before considering any single-day match. The end day is inclusive.
  const range = q.match(
    new RegExp(
      `\\b(?:between|from)\\s+(${datePattern})\\s+(?:and|to|through|until|–|-)\\s+(${datePattern})\\b`,
    ),
  );
  if (range) {
    const right = explicit(range[2], time);
    const left = explicit(range[1], time, right ?? undefined);
    const end = explicit(range[2], time, left ?? undefined);
    if (!left || !end) return null;
    // An omitted start year may refer to December of the previous year.
    const start =
      left > end && !/20\d{2}/.test(range[1]) && left.month > end.month
        ? left.minus({ years: 1 })
        : left;
    return window(start, end);
  }
  if (
    /\b(?:between|from)\b.*\b(?:and|to|through|until)\b/.test(q) &&
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|20\d{2}-)/.test(q)
  )
    return null;
  const rolling = q.match(/\b(?:past|last)\s+(\d+|[a-z]+)\s+days\b/);
  if (rolling) {
    const count = /^\d+$/.test(rolling[1])
      ? Number(rolling[1])
      : numbers.indexOf(rolling[1]);
    return count > 0 && count <= 3660
      ? window(time.minus({ days: count - 1 }), time)
      : null;
  }
  const week = q.match(/\b(last|this|previous)\s+week\b/);
  if (week) {
    const start = time
      .startOf("week")
      .minus({ weeks: week[1] === "this" ? 0 : 1 });
    return window(start, start.plus({ days: 6 }));
  }
  const offset = q.match(/\b(\d+|[a-z]+)\s+(days?|weeks?)\s+ago\b/);
  if (offset) {
    const count = /^\d+$/.test(offset[1])
      ? Number(offset[1])
      : numbers.indexOf(offset[1]);
    if (count < 0 || count > 3660) return null;
    const day = time.minus(
      offset[2].startsWith("week") ? { weeks: count } : { days: count },
    );
    return window(day, day);
  }
  const iso = q.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  if (iso) {
    const day = explicit(iso[0], time);
    return day ? window(day, day) : null;
  }
  if (/\byesterday\b/.test(q))
    return window(time.minus({ days: 1 }), time.minus({ days: 1 }));
  const wd = q.match(
    /\b(last\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (wd) {
    let delta = (time.weekday - (weekdays.indexOf(wd[2]) + 1) + 7) % 7;
    if (wd[1] && delta === 0) delta = 7;
    return window(time.minus({ days: delta }), time.minus({ days: delta }));
  }
  const date = q.match(
    new RegExp(
      `\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${monthPattern})(?:\\s+20\\d{2})?|(?:${monthPattern})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?)\\b`,
    ),
  );
  if (date) {
    const day = explicit(date[0], time);
    return day ? window(day, day) : null;
  }
  return /\btoday\b/.test(q) && /ask|said|discuss|talk|remember/.test(q)
    ? window(time, time)
    : null;
}
