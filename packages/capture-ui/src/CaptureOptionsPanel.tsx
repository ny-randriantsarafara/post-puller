// A row per option, discriminated by the kind of value it edits. A capture that
// can run for an hour needs to be bounded by a count or a date, not only by
// switches, so the panel is not a list of checkboxes.
export type CaptureOptionRow<TOptions extends object> =
  | {
      kind: 'toggle';
      key: keyof TOptions & string;
      label: string;
      hint: string;
    }
  | {
      kind: 'number';
      key: keyof TOptions & string;
      label: string;
      hint: string;
      min?: number;
      placeholder?: string;
    }
  | {
      kind: 'date';
      key: keyof TOptions & string;
      label: string;
      hint: string;
    };

type CaptureOptionsPanelProps<TOptions extends object> = {
  legend: string;
  options: TOptions;
  rows: readonly CaptureOptionRow<TOptions>[];
  isDisabled: boolean;
  onOptionsChange: (options: TOptions) => void;
};

function readToggle(value: unknown): boolean {
  return value === true;
}

// An empty field means "no bound", which is not the same as zero, so it reads
// back as null rather than being coerced.
function readOptionalNumber(value: string): number | null {
  if (value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalText(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' ? String(value) : '';
}

function formatDate(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

export function CaptureOptionsPanel<TOptions extends object>({
  legend,
  options,
  rows,
  isDisabled,
  onOptionsChange,
}: CaptureOptionsPanelProps<TOptions>) {
  function update(key: keyof TOptions & string, value: unknown): void {
    onOptionsChange({ ...options, [key]: value });
  }

  return (
    <fieldset className="cui-options" disabled={isDisabled}>
      <legend className="cui-options__legend">{legend}</legend>
      {rows.map((row) => {
        switch (row.kind) {
          case 'toggle':
            return (
              <label className="cui-options__row" key={row.key}>
                <input
                  type="checkbox"
                  checked={readToggle(options[row.key])}
                  disabled={isDisabled}
                  onChange={(event) => {
                    update(row.key, event.target.checked);
                  }}
                />
                <span className="cui-options__label">{row.label}</span>
                <span className="cui-options__hint">{row.hint}</span>
              </label>
            );
          case 'number':
            return (
              <label className="cui-options__row cui-options__row--field" key={row.key}>
                <span className="cui-options__label">{row.label}</span>
                <input
                  type="number"
                  min={row.min}
                  placeholder={row.placeholder}
                  value={formatNumber(options[row.key])}
                  disabled={isDisabled}
                  onChange={(event) => {
                    update(row.key, readOptionalNumber(event.target.value));
                  }}
                />
                <span className="cui-options__hint">{row.hint}</span>
              </label>
            );
          case 'date':
            return (
              <label className="cui-options__row cui-options__row--field" key={row.key}>
                <span className="cui-options__label">{row.label}</span>
                <input
                  type="date"
                  value={formatDate(options[row.key])}
                  disabled={isDisabled}
                  onChange={(event) => {
                    update(row.key, readOptionalText(event.target.value));
                  }}
                />
                <span className="cui-options__hint">{row.hint}</span>
              </label>
            );
          default: {
            const unhandled: never = row;
            throw new Error(`Unhandled capture option row: ${String(unhandled)}`);
          }
        }
      })}
    </fieldset>
  );
}
