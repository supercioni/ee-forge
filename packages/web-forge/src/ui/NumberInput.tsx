import { useState } from "react";
import { displayText, editFor, isOutOfRange, stepBy } from "./number-field.js";

/**
 * A numeric field that lets you finish typing.
 *
 * Every number in the editor goes through this. It is a text input, not
 * `type="number"`, because the native one hides exactly the states an
 * author passes through — a lone `-`, a trailing `.`, a bare `1e` — behind
 * an empty string, so a controlled component reading `e.target.value`
 * cannot tell "cleared" from "half-way to -13000". The document only ever
 * receives complete numbers; the partial text lives here until it is one.
 *
 * Arrow keys still step (Shift ×10), which was the native input's one real
 * advantage, and out-of-range values are shown rather than blocked — a
 * value the schema will refuse should be visible while it is written, not
 * discovered when the save fails.
 */
export function NumberInput({
  value,
  onChange,
  nullable = false,
  min,
  max,
  step,
  placeholder,
  disabled,
  label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Whether an emptied field means "unset" rather than "keep the last value". */
  nullable?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** The accessible name, for a field whose visible label is not wrapped around it. */
  label?: string | undefined;
}): JSX.Element {
  // Null while the field is idle, so it follows the document; a string
  // while the author is typing, so the document cannot fight the keyboard.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string): void => {
    setDraft(text);
    const edit = editFor(text, nullable);
    if (edit.kind === "commit") onChange(edit.value);
    else if (edit.kind === "clear") onChange(null);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={isOutOfRange(value, min, max) ? "out-of-range" : undefined}
      value={draft ?? displayText(value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => commit(e.target.value)}
      // Dropping the draft on blur resyncs the field: a dangling "-" that
      // never became a number reverts to what the document actually holds.
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const next = stepBy(value, e.key === "ArrowUp" ? 1 : -1, {
          step,
          magnify: e.shiftKey,
          min,
          max,
        });
        setDraft(String(next));
        onChange(next);
      }}
    />
  );
}
