import { Application, type AppInfo } from "./mygo";

export type { AppInfo };

/** Reads the app metadata from the Go backend. */
export function getAppInfo(): Promise<AppInfo> {
  return Application.info();
}
