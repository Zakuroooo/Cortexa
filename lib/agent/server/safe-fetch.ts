// Adapted from FreelanceOS (src/lib/safeFetch.ts) — same SSRF guard.
import { lookup } from 'node:dns'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch, type RequestInit as UndiciInit } from 'undici'

/**
 * Fetch a URL that a user typed (a client's website) without letting it reach internal addresses (SSRF).
 * - only http/https on ports 80/443
 * - the address check runs INSIDE the socket connect (custom lookup), so the connection goes to exactly
 *   the IP that was checked — no DNS-rebinding window between "check" and "connect"
 * - IPv4: deny private/reserved ranges; IPv6: allow only global unicast 2000::/3 (minus 6to4/Teredo);
 *   IPv4-mapped IPv6 in any notation is converted to IPv4 and checked as IPv4
 * - redirects are followed manually and every hop goes through the same checks
 */
const MAX_REDIRECTS = 5

function isPrivateIPv4(ip: string) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
}

/** Expand an IPv6 string to 8 hex groups (handles "::" and a trailing dotted IPv4). */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const p = dotted[1].split('.').map(Number)
    s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16)
  }
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  const fill = s.includes('::') ? 8 - h.length - t.length : 0
  const all = [...h, ...Array(fill).fill('0'), ...t]
  if (all.length !== 8) return null
  const g = all.map((x) => parseInt(x, 16))
  return g.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : g
}

export function isBlockedIP(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isPrivateIPv4(ip)
  if (v !== 6) return true
  const g = ipv6Groups(ip)
  if (!g) return true
  // IPv4-mapped (::ffff:a.b.c.d) → check the embedded IPv4
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return isPrivateIPv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`)
  }
  const first = g[0]
  if (first < 0x2000 || first > 0x3fff) return true        // only global unicast 2000::/3
  if (first === 0x2002) return true                        // 6to4 can embed private IPv4
  if (first === 0x2001 && g[1] === 0x0000) return true      // Teredo
  return false
}

// Every socket this agent opens resolves the host itself and refuses blocked addresses.
const agent = new Agent({
  connect: {
    // Node may ask for one address or (with happy-eyeballs) all of them; answer in the shape it asked for.
    lookup(hostname, options, cb) {
      lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err, '', 4)
        const list = addrs as unknown as { address: string; family: number }[]
        if (!list.length || list.some((a) => isBlockedIP(a.address))) return cb(new Error('This address is not allowed'), '', 4)
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list)
        cb(null, list[0].address, list[0].family)
      })
    },
  },
})

export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https URLs are allowed')
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('Only ports 80 and 443 are allowed')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && isBlockedIP(host)) throw new Error('This address is not allowed') // literal IPs never hit DNS
  return u
}

export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  let url = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicUrl(url)
    const res = await undiciFetch(url, { ...(init as UndiciInit), redirect: 'manual', dispatcher: agent })
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).toString(); continue }
    return res as unknown as Response
  }
  throw new Error('Too many redirects')
}
