import { toErrorMessage } from '../shared/errorMessage';
import { handleBackgroundMessage, registerLifecycleHandlers } from './captureCoordinator';

registerLifecycleHandlers();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Always answering keeps the popup from parsing an undefined response when a
  // handler fails.
  void handleBackgroundMessage(message, sender).then(sendResponse, (error: unknown) => {
    sendResponse({
      type: 'ERROR',
      message: toErrorMessage(error),
    });
  });

  return true;
});
