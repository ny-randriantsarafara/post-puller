import { handleContentMessage, initializeCaptureController } from './captureController';

initializeCaptureController();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleContentMessage(message, sender).then(sendResponse);
  return true;
});
