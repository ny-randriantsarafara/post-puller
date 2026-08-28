export type PostAuthor =
  | { kind: 'named'; name: string; profileUrl: string | null }
  | { kind: 'anonymous'; label: string }
  | { kind: 'unknown' };
