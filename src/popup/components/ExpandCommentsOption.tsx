type ExpandCommentsOptionProps = {
  expandComments: boolean;
  isDisabled: boolean;
  onExpandCommentsChange: (expandComments: boolean) => void;
};

export function ExpandCommentsOption({
  expandComments,
  isDisabled,
  onExpandCommentsChange,
}: ExpandCommentsOptionProps) {
  return (
    <label className="popup__option">
      <input
        type="checkbox"
        checked={expandComments}
        disabled={isDisabled}
        onChange={(event) => {
          onExpandCommentsChange(event.target.checked);
        }}
      />
      <span className="popup__option-label">Expand comments while capturing (slower)</span>
      <span className="popup__option-hint">
        Clicks View more comments and reply expanders a few times per post.
      </span>
    </label>
  );
}
