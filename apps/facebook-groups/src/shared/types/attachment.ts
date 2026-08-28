export type Attachment =
  | { kind: 'image' | 'video' | 'link' | 'sharedPost'; url: string | null }
  | { kind: 'none' }
  | { kind: 'unknown' };
