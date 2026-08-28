import { toErrorMessage } from '../errorMessage';
import { err, ok, type Result } from '../result';
import {
  parseBackgroundResponse,
  type BackgroundRequest,
  type BackgroundResponse,
} from './protocol';

export async function sendBackgroundRequest(
  request: BackgroundRequest,
): Promise<BackgroundResponse> {
  const response: unknown = await chrome.runtime.sendMessage(request);
  return parseBackgroundResponse(response);
}

// Messaging fails whenever the other end is gone: an extension reload leaves
// old tabs without a content script, and a closed tab leaves the service worker
// without a listener. Callers must handle that instead of raising an unhandled
// promise rejection.
export async function trySendBackgroundRequest(
  request: BackgroundRequest,
): Promise<Result<BackgroundResponse, string>> {
  try {
    return ok(await sendBackgroundRequest(request));
  } catch (error) {
    return err(toErrorMessage(error));
  }
}

export async function sendTabRequest<TResponse>(
  tabId: number,
  request: unknown,
  parseResponse: (value: unknown) => TResponse,
): Promise<TResponse> {
  const response: unknown = await chrome.tabs.sendMessage(tabId, request);
  return parseResponse(response);
}

export async function trySendTabRequest<TResponse>(
  tabId: number,
  request: unknown,
  parseResponse: (value: unknown) => TResponse,
): Promise<Result<TResponse, string>> {
  try {
    return ok(await sendTabRequest(tabId, request, parseResponse));
  } catch (error) {
    return err(toErrorMessage(error));
  }
}
