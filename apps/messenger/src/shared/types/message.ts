import type { MessageWarning } from './warnings';

// Messenger names the reader "You" and everybody else by their display name.
// There is no other direction signal in the DOM, so the distinction is modelled
// rather than left as a name a caller has to compare against a magic string.
export type MessageSender = { kind: 'self' } | { kind: 'other'; name: string };

export type MessageReaction = {
  count: number;
  emoji: string;
};

export type MessageAttachment =
  | { kind: 'none' }
  | { kind: 'file'; caption: string }
  | { kind: 'story' };

// What a single row of the thread yields on its own. Turning this into a stored
// item - identity key, thread, capture timestamps - belongs to the adapter that
// knows which thread is on screen, not to the parser.
export type ParsedMessage = {
  messageId: string | null;
  sender: MessageSender | null;
  displayedAt: string | null;
  sentAt: string | null;
  text: string | null;
  isReply: boolean;
  reactions: MessageReaction[];
  attachments: MessageAttachment[];
  warnings: MessageWarning[];
};
