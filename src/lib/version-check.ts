const NPM_REGISTRY_URL = "https://registry.npmjs.org/@realtimex/folio/latest";
const VERSION_CHECK_CACHE_KEY = "folio_last_version_check";
const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function getCurrentVersion(): string {
  return import.meta.env.VITE_APP_VERSION || "unknown";
}

export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);

  const [aMaj, aMin, aPatch] = parse(current);
  const [bMaj, bMin, bPatch] = parse(latest);

  if (bMaj !== aMaj) return bMaj > aMaj;
  if (bMin !== aMin) return bMin > aMin;
  return bPatch > aPatch;
}

function shouldCheckVersion(): boolean {
  try {
    const lastCheck = localStorage.getItem(VERSION_CHECK_CACHE_KEY);
    if (!lastCheck) return true;
    return Date.now() - new Date(lastCheck).getTime() > VERSION_CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markChecked() {
  try {
    localStorage.setItem(VERSION_CHECK_CACHE_KEY, new Date().toISOString());
  } catch {
    // no-op
  }
}

export async function checkForUpdates(): Promise<{ current: string; latest: string } | null> {
  if (!shouldCheckVersion()) {
    return null;
  }

  const current = getCurrentVersion();

  try {
    const response = await fetch(NPM_REGISTRY_URL, { cache: "no-store" });
    const json = await response.json();
    const latest = json?.version;

    markChecked();

    if (typeof latest === "string" && isNewerVersion(current, latest)) {
      return { current, latest };
    }

    return null;
  } catch {
    markChecked();
    return null;
  }
}
