import { Application, type AppInfo } from "./mygo";

export type { AppInfo };

/** Reads the app metadata from the Go backend. */
export function getAppInfo(): Promise<AppInfo> {
  return Application.info();
}

/** Opens a validated HTTP(S) URL in the system browser. */
export function openExternalURL(target: string): Promise<void> {
  return Application.openExternalURL(target);
}
