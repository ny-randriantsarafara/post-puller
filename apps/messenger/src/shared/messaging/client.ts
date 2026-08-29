import { createMessagingClient } from '@extractor/capture-core/messaging';
import {
  parseBackgroundResponse,
  type BackgroundRequest,
  type BackgroundResponse,
} from './protocol';

const client = createMessagingClient<BackgroundRequest, BackgroundResponse>(
  parseBackgroundResponse,
);

export const sendBackgroundRequest = client.send;
export const trySendBackgroundRequest = client.trySend;
