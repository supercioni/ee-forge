/**
 * A span of seconds, said the way a person reads a clock.
 *
 * Written for `Planet.orbit.orbitTimeS`, which is the time a planet takes
 * to go round once. A raw `3600` in a number box does not tell an author
 * whether the moon will drift or spin, and the field's old name claimed
 * it was a rate — so every orbit in this project was authored as a
 * carousel. The readout under the field is the correction that cannot be
 * missed, so it is always on rather than a tooltip.
 *
 * Pure, and tested, because the rounding has more edges than it looks:
 * 3599.9 seconds must not print as "1h 60m".
 */
export function formatPeriod(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds === 0) return "—";

  // EE happily runs a negative period; it just goes round the other way.
  const retrograde = seconds < 0;
  const total = Math.abs(seconds);
  const text = retrograde ? `${spell(total)}, retrograde` : spell(total);
  return text;
}

function spell(total: number): string {
  // Sub-minute periods are the pathological ones this readout exists to
  // expose, so they keep their fraction: someone who typed 1.3 has to
  // see 1.3, not a tidied "1s".
  const tenths = Math.round(total * 10) / 10;
  if (tenths < 60) return `${tenths}s`;

  // Above a minute, resolve to whole seconds BEFORE splitting into
  // columns. Rounding inside a column is what prints "1m 60s" and,
  // one base up, "1h 60m".
  const whole = Math.round(total);

  if (whole < 3600) {
    const minutes = Math.floor(whole / 60);
    const seconds = whole - minutes * 60;
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${pad(seconds)}s`;
  }

  const hours = Math.floor(whole / 3600);
  const minutes = Math.round((whole - hours * 3600) / 60);
  // The one carry left: 1h 59m 30s rounds its minutes up to 60.
  if (minutes === 60) return `${hours + 1}h 00m`;
  return `${hours}h ${pad(minutes)}m`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
