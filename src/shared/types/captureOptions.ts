export type CaptureOptions = {
  expandPostText: boolean;
  expandComments: boolean;
  captureReactions: boolean;
};

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  expandPostText: true,
  expandComments: false,
  captureReactions: true,
};
