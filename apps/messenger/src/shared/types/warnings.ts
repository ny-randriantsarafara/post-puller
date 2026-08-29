export const MESSAGE_WARNINGS = [
  'MISSING_MESSAGE_ID',
  'REJECTED_MESSAGE_ID',
  'MISSING_SENDER',
  'MISSING_TEXT',
  'MISSING_TIMESTAMP',
  'UNPARSED_TIMESTAMP',
  // A timestamp Messenger rendered relative to the day of the capture, so the
  // resolved instant is only as good as the clock that read it.
  'INFERRED_TIMESTAMP',
] as const;

export type MessageWarning = (typeof MESSAGE_WARNINGS)[number];
