// Where a walk may reach. `aidt qa walk` is pre-approved for an agent that writes the walks, so the
// limit comes from the config, which the agent cannot write: by default this machine only, so a
// walk cannot carry what it reads in the app anywhere else.

/** The entry of `qa.origins` that stands for every port of this machine. */
const LOCAL = "local";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const WEB = new Set(["http:", "https:", "ws:", "wss:"]);

/** What is wrong with `qa.origins`, or `undefined`: each entry is `local` or an http(s) origin. */
export function originsProblem(origins: unknown): string | undefined {
  const wrong = Array.isArray(origins)
    ? origins.filter((entry) => {
        if (entry === LOCAL) return false;
        try {
          const url = new URL(String(entry));
          return !["http:", "https:"].includes(url.protocol) || url.origin !== entry;
        } catch {
          return true;
        }
      })
    : [origins];
  if (wrong.length === 0) return undefined;
  return `qa.origins takes "${LOCAL}" (this machine, any port) and origins such as "https://staging.example.com", not ${wrong.map((w) => JSON.stringify(w)).join(", ")}`;
}

/** Whether an address is one a walk may reach: this machine, or an origin of `qa.origins`. */
export function originPolicy(origins: readonly string[]): (address: string) => boolean {
  const local = origins.includes(LOCAL);
  const exact = new Set(origins.filter((origin) => origin !== LOCAL));
  return (address) => {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return false;
    }
    if (!WEB.has(url.protocol)) return false;
    const host = url.hostname;
    if (local && LOCAL_HOSTS.has(host)) return true;
    return exact.has(`${url.protocol.replace(/^ws/, "http")}//${url.host}`);
  };
}

/** How the log names a call the walk did not let out. */
export const BLOCKED = "blocked: outside qa.origins";
