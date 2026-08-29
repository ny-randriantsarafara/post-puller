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
  // No date could be resolved at all. The message is stored and enumerable, and
  // a later flush that brings its date separator into view can still resolve it.
  'UNRESOLVED_TIMESTAMP',
  // The message carried no usable id, so it is keyed by a hash of its content
  // and its position among identical messages from the same sender.
  'UNSTABLE_IDENTITY',
  // The scan exceeded the bucket cap that keeps identical short messages apart,
  // so this one could not be separated from its twins.
  'DUPLICATE_INDEX_OVERFLOW',
  // The message was captured, then unsent before a later scan saw it again.
  'UNSENT_AFTER_CAPTURE',
] as const;

export type MessageWarning = (typeof MESSAGE_WARNINGS)[number];
