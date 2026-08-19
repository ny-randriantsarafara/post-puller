import type { CaptureMode } from '../../shared/types';

type ScanModeSelectorProps = {
  mode: CaptureMode;
  isDisabled: boolean;
  onModeChange: (mode: CaptureMode) => void;
};

type ScanModeOption = {
  value: CaptureMode;
  label: string;
  hint: string;
};

const SCAN_MODE_OPTIONS: ScanModeOption[] = [
  {
    value: 'manual',
    label: 'Manual scan',
    hint: 'You scroll the group yourself.',
  },
  {
    value: 'auto',
    label: 'Automatic scan',
    hint: 'The page scrolls itself until the feed stops loading.',
  },
];

export function ScanModeSelector({
  mode,
  isDisabled,
  onModeChange,
}: ScanModeSelectorProps) {
  return (
    <fieldset className="popup__modes" disabled={isDisabled}>
      <legend className="popup__modes-legend">Scan mode</legend>
      {SCAN_MODE_OPTIONS.map((option) => (
        <label className="popup__mode" key={option.value}>
          <input
            type="radio"
            name="scan-mode"
            value={option.value}
            checked={mode === option.value}
            onChange={() => {
              onModeChange(option.value);
            }}
          />
          <span className="popup__mode-label">{option.label}</span>
          <span className="popup__mode-hint">{option.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
