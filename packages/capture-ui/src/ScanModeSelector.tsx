import type { CaptureMode } from '@extractor/capture-core/messaging';

export type ScanModeOption = {
  value: CaptureMode;
  label: string;
  // What the mode does on this site. Automatic means scrolling a feed downward
  // in one extension and a conversation upward in the other.
  hint: string;
};

type ScanModeSelectorProps = {
  mode: CaptureMode;
  options: readonly ScanModeOption[];
  isDisabled: boolean;
  onModeChange: (mode: CaptureMode) => void;
};

export function ScanModeSelector({
  mode,
  options,
  isDisabled,
  onModeChange,
}: ScanModeSelectorProps) {
  return (
    <fieldset className="cui-modes" disabled={isDisabled}>
      <legend className="cui-modes__legend">Scan mode</legend>
      {options.map((option) => (
        <label className="cui-mode" key={option.value}>
          <input
            type="radio"
            name="scan-mode"
            value={option.value}
            checked={mode === option.value}
            onChange={() => {
              onModeChange(option.value);
            }}
          />
          <span className="cui-mode__label">{option.label}</span>
          <span className="cui-mode__hint">{option.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
