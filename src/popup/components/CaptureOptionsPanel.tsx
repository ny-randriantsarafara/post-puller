import type { CaptureOptions } from '../../shared/types';

type CaptureOptionKey = keyof CaptureOptions;

type CaptureOptionsPanelProps = {
  options: CaptureOptions;
  isDisabled: boolean;
  onOptionsChange: (options: CaptureOptions) => void;
};

type CaptureOptionRow = {
  key: CaptureOptionKey;
  label: string;
  hint: string;
};

const CAPTURE_OPTION_ROWS: CaptureOptionRow[] = [
  {
    key: 'expandPostText',
    label: 'Expand post text while capturing',
    hint: 'Clicks See more / Voir plus inside post messages.',
  },
  {
    key: 'expandComments',
    label: 'Expand comments while capturing (slower)',
    hint: 'Clicks View more comments and reply expanders a few times per post.',
  },
  {
    key: 'captureReactions',
    label: 'Capture reactions',
    hint: 'Stores reaction totals and the visible per-type breakdown from the feed.',
  },
];

export function CaptureOptionsPanel({
  options,
  isDisabled,
  onOptionsChange,
}: CaptureOptionsPanelProps) {
  return (
    <fieldset className="popup__options" disabled={isDisabled}>
      <legend className="popup__options-legend">Capture options</legend>
      {CAPTURE_OPTION_ROWS.map((row) => (
        <label className="popup__options-row" key={row.key}>
          <input
            type="checkbox"
            checked={options[row.key]}
            disabled={isDisabled}
            onChange={(event) => {
              onOptionsChange({
                ...options,
                [row.key]: event.target.checked,
              });
            }}
          />
          <span className="popup__options-label">{row.label}</span>
          <span className="popup__options-hint">{row.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
