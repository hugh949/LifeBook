export const SUPPORTED_LANGUAGES = ["en","zh-yue","zh","es","ur"] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];
export const DEFAULT_LANGUAGE: SupportedLanguage | "auto" = "auto";
