export type AppPlatform = "macos" | "windows" | "linux";

export function appPlatform(os: string): AppPlatform {
  if (os === "darwin" || os === "macos") {
    return "macos";
  }
  if (os === "windows" || os === "win32") {
    return "windows";
  }
  return "linux";
}

export function isMac(platform: AppPlatform): boolean {
  return platform.startsWith("mac");
}

export function revealLabel(platform: AppPlatform): string {
  if (platform === "windows") {
    return "在资源管理器中显示";
  }
  if (platform === "linux") {
    return "在文件管理器中显示";
  }
  return "在 Finder 中显示";
}

export function trashLabel(platform: AppPlatform): string {
  return isMac(platform) ? "移到废纸篓" : "移到回收站";
}
