let identity: string | undefined;
let generation = 0;
const requests = new Set<AbortController>();

export function currentSessionGeneration() {
  return generation;
}

export function invalidateSessionGeneration() {
  generation++;
  for (const request of requests) request.abort();
  requests.clear();
}

export function registerSessionRequest() {
  const controller = new AbortController();
  requests.add(controller);
  return controller;
}

export function releaseSessionRequest(controller: AbortController) {
  requests.delete(controller);
}

export function setSessionIdentity(next: string | undefined) {
  if (next === identity) return;
  identity = next;
  invalidateSessionGeneration();
}
