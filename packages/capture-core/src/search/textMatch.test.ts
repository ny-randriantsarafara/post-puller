import { describe, expect, it } from 'vitest';
import { createSearchMatcher, foldSearchText } from './textMatch';

describe('foldSearchText', () => {
  it('strips accents and lowers the case', () => {
    expect(foldSearchText('Élodie A ÇÀ')).toBe('elodie a ca');
  });
});

describe('createSearchMatcher', () => {
  it('matches a part regardless of case', () => {
    const matches = createSearchMatcher('WORD');

    expect(matches(['a word in the middle'])).toBe(true);
  });

  it('matches an accented part typed without its accents', () => {
    const matches = createSearchMatcher('reunion');

    expect(matches(['la réunion de lundi'])).toBe(true);
  });

  it('matches an unaccented part typed with accents', () => {
    const matches = createSearchMatcher('réunion');

    expect(matches(['la reunion de lundi'])).toBe(true);
  });

  // The parts are an author and a body, and a query is not allowed to be half of
  // each: an author called Marie beside a body opening with "wrote" is not a
  // record that says "Marie wrote".
  it('does not match across two parts', () => {
    const matches = createSearchMatcher('Marie wrote');

    expect(matches(['Marie', 'wrote something else'])).toBe(false);
  });

  it('matches everything when the query is blank', () => {
    const matches = createSearchMatcher('   ');

    expect(matches(['anything at all'])).toBe(true);
    expect(matches([])).toBe(true);
  });

  it('matches nothing when no part contains the query', () => {
    const matches = createSearchMatcher('absent');

    expect(matches(['one thing', 'another thing'])).toBe(false);
  });
});
