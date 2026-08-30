// Where a page starts, given how many items an order puts ahead of the one being
// looked for. This is what turns countItemsBefore into something a preview can
// page to: the reader lands on the page that item sits on and keeps paging from
// there, rather than seeing a list narrowed to it.
//
// The clamp is the part worth having. A date after the last item counts every
// item as ahead of it, and when the count divides exactly by the page size the
// offset that follows is one page past the end: a page with nothing on it, whose
// only affordance is going back. A total of null is a filtered read, which does
// not know how many matched and so cannot clamp.
export function resolvePageOffset(
  itemsBefore: number,
  pageSize: number,
  total: number | null,
): number {
  const pageStart = Math.floor(itemsBefore / pageSize) * pageSize;

  if (total === null) {
    return pageStart;
  }

  const lastPageStart = Math.max(0, Math.floor((total - 1) / pageSize) * pageSize);

  return Math.min(pageStart, lastPageStart);
}
