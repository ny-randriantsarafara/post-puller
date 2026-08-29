import { createCaptureController } from '@extractor/capture-core/content';
import { captureProtocol } from '../shared/messaging/protocol';
import { DEFAULT_CAPTURE_OPTIONS } from '../shared/types/captureOptions';
import { facebookSiteAdapter } from './facebookSiteAdapter';

const controller = createCaptureController({
  adapter: facebookSiteAdapter,
  protocol: captureProtocol,
  defaultOptions: DEFAULT_CAPTURE_OPTIONS,
});

export const initializeCaptureController = controller.initialize;
export const handleContentMessage = controller.handleContentMessage;
