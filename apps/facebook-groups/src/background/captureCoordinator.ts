import { createCaptureCoordinator } from '@extractor/capture-core/background';
import { facebookGroupsDomain } from '../shared/domain';
import { captureProtocol } from '../shared/messaging/protocol';
import { postRepository } from '../shared/storage/postRepository';
import { sessionStore } from './sessionStore';

const coordinator = createCaptureCoordinator({
  domain: facebookGroupsDomain,
  protocol: captureProtocol,
  repository: postRepository,
  sessionStore,
  copy: {
    contentScriptUnreachable:
      'Could not reach the Facebook tab. Refresh it, then start capture again.',
    pageInfoUnreadable: 'Unable to read page info from the Facebook tab.',
    notOnTargetPage: 'Open a Facebook group page before starting capture.',
  },
});

export const handleBackgroundMessage = coordinator.handleBackgroundMessage;
export const registerLifecycleHandlers = coordinator.registerLifecycleHandlers;
