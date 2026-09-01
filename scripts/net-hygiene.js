export const NET_LIMITS = Object.freeze({
  RECONNECT_DELAY_MAX_MS: 20000,
  RECONNECT_ATTEMPTS: 10,
  TYPING_MIN_INTERVAL_MS: 2000,
  TYPING_IDLE_STOP_MS: 1600,
  VISIBILITY_RESUME_DELAY_MS: 200,
});

export function pageHidden() {
  return document.hidden;
}
