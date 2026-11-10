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
export function resolveDate(
  text: string,
  timezone: string,
  clock = new Date(),
): DateWindow | null {
  let time = DateTime.fromJSDate(clock, { zone: timezone });
  if (!time.isValid) time = DateTime.fromJSDate(clock, { zone: "UTC" });
  const q = text.toLowerCase();
  let day: DateTime | null = null;
  const iso = q.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) day = DateTime.fromISO(iso[1], { zone: time.zoneName! });
  else if (/\byesterday\b/.test(q)) day = time.minus({ days: 1 });
  else {
    const wd = q.match(
      /\b(last\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
    );
    if (wd) {
      let delta = (time.weekday - (weekdays.indexOf(wd[2]) + 1) + 7) % 7;
      if (wd[1] && delta === 0) delta = 7;
      day = time.minus({ days: delta });
    } else {
      const date = q.match(
        /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)(?:\s+(20\d{2}))?\b/,
      );
      const flipped = q.match(
        /\b(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/,
      );
      if (date || flipped) {
        const month = date?.[2] ?? flipped![1];
        const number = Number(date?.[1] ?? flipped![2]);
        const year = Number(date?.[3] ?? flipped?.[3] ?? time.year);
        const index = months.findIndex((m) => m.startsWith(month.slice(0, 3)));
        day = DateTime.fromObject(
          { year, month: index + 1, day: number },
          { zone: time.zoneName! },
        );
      } else if (
        /\btoday\b/.test(q) &&
        /ask|said|discuss|talk|remember/.test(q)
      )
        day = time;
    }
  }
  if (!day?.isValid) return null;
  day = day.startOf("day");
  return {
    from: day.toUTC().toISO()!,
    to: day.plus({ days: 1 }).toUTC().toISO()!,
    label: day.toFormat("d LLLL yyyy"),
  };
}
