export type PostAuthor =
  | { kind: 'named'; name: string; profileUrl: string | null }
  | { kind: 'anonymous'; label: string }
  | { kind: 'unknown' };

// The author as keys are built from it. Hashed into the identity of a post with
// no id of its own and into the key comments are merged under, so the strings
// here are fixed: returning something else for an unknown author would give
// every such post a new identity and re-import it.
export function resolveAuthorLabel(author: PostAuthor): string {
  if (author.kind === 'named') {
    return author.name;
  }

  if (author.kind === 'anonymous') {
    return author.label;
  }

  return 'unknown-author';
}

// The author as a reader sees it. Separate from the label above because that one
// cannot change and this one is only ever displayed.
export function formatAuthorLabel(author: PostAuthor): string {
  if (author.kind === 'named') {
    return author.name;
  }

  if (author.kind === 'anonymous') {
    return author.label;
  }

  return 'Unknown author';
}
