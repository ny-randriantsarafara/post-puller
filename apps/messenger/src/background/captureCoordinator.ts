import { createCaptureCoordinator } from '@extractor/capture-core/background';
import { messengerDomain } from '../shared/domain';
import { captureProtocol } from '../shared/messaging/protocol';
import { messageRepository } from '../shared/storage/messageRepository';
import { sessionStore } from './sessionStore';

const coordinator = createCaptureCoordinator({
  domain: messengerDomain,
  protocol: captureProtocol,
  repository: messageRepository.asItemRepository,
  sessionStore,
  copy: {
    contentScriptUnreachable:
      'Could not reach the Messenger tab. Refresh it, then start the scan again.',
    pageInfoUnreadable: 'Unable to read thread info from the Messenger tab.',
    notOnTargetPage: 'Open a Messenger conversation before starting a scan.',
  },
});

export const handleBackgroundMessage = coordinator.handleBackgroundMessage;
export const registerLifecycleHandlers = coordinator.registerLifecycleHandlers;
