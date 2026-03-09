export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function decodeSharedParam<T>(value: string | string[] | undefined): T | null {
  const encoded = Array.isArray(value) ? value[0] : value;
  if (!encoded) return null;
  try {
    const json = typeof globalThis.Buffer !== 'undefined'
      ? Buffer.from(encoded, 'base64').toString('utf-8')
      : decodeURIComponent(escape(atob(encoded)));
    return JSON.parse(decodeURIComponent(json)) as T;
  } catch {
    return null;
  }
}
