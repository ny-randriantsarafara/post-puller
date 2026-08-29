// What the content script can tell about the page it was injected into. The
// background worker reads the same shape back over messaging.
export type PageTarget = {
  isTargetPage: boolean;
  collectionName: string | null;
  collectionUrl: string | null;
};
