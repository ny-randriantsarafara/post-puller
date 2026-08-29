import { toErrorMessage } from '../errorMessage';
import { err, ok, type Result } from '../result';

export type MessagingClient<TRequest, TResponse> = {
  send: (request: TRequest) => Promise<TResponse>;
  trySend: (request: TRequest) => Promise<Result<TResponse, string>>;
};

// Messaging fails whenever the other end is gone: an extension reload leaves
// old tabs without a content script, and a closed tab leaves the service worker
// without a listener. Callers must handle that instead of raising an unhandled
// promise rejection, which is what the try* variants are for.
export function createMessagingClient<TRequest, TResponse>(
  parseResponse: (value: unknown) => TResponse,
): MessagingClient<TRequest, TResponse> {
  async function send(request: TRequest): Promise<TResponse> {
    const response: unknown = await chrome.runtime.sendMessage(request);
    return parseResponse(response);
  }

  async function trySend(request: TRequest): Promise<Result<TResponse, string>> {
    try {
      return ok(await send(request));
    } catch (error) {
      return err(toErrorMessage(error));
    }
  }

  return { send, trySend };
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
