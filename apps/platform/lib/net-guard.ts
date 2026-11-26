// Is an IP address somewhere a server-side fetch must never reach? Private,
// loopback, link-local, carrier-grade NAT, multicast, documentation and
// reserved ranges, for IPv4 and IPv6 (including IPv4-mapped and NAT64 forms).
// Pure, so it's tested without a network. Used by lib/server/safe-fetch.ts.

const V4_BLOCKED: [number, number][] = [
  // [network as a 32-bit number, prefix length]
  [v4("0.0.0.0"), 8],
  [v4("10.0.0.0"), 8],
  [v4("100.64.0.0"), 10],
  [v4("127.0.0.0"), 8],
  [v4("169.254.0.0"), 16],
  [v4("172.16.0.0"), 12],
  [v4("192.0.0.0"), 24],
  [v4("192.0.2.0"), 24],
  [v4("192.88.99.0"), 24],
  [v4("192.168.0.0"), 16],
  [v4("198.18.0.0"), 15],
  [v4("198.51.100.0"), 24],
  [v4("203.0.113.0"), 24],
  [v4("224.0.0.0"), 4],
  [v4("240.0.0.0"), 4],
];

function v4(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

function isV4(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split(".").every((p) => Number(p) <= 255);
}

function v4Blocked(ip: string): boolean {
  const n = v4(ip);
  return V4_BLOCKED.some(([net, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(net / 2 ** (32 - bits)));
}

/** "::ffff:1.2.3.4" → 8 groups of 16 bits; null if it isn't IPv6. */
function v6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const tail = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    if (!isV4(tail[1])) return null;
    const n = v4(tail[1]);
    text = text.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(text) || !text.includes(":")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function v6Blocked(g: number[]): boolean {
  const zeroUntil = (i: number) => g.slice(0, i).every((x) => x === 0);
  if (zeroUntil(8)) return true; // ::
  if (zeroUntil(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4 part.
  if ((zeroUntil(5) && g[5] === 0xffff) || zeroUntil(6)) return v4Blocked(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return v4Blocked(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  return false;
}

/** True when the address must not be fetched. Anything unparseable counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  if (isV4(ip)) return v4Blocked(ip);
  const groups = v6Groups(ip);
  return groups ? v6Blocked(groups) : true;
}
