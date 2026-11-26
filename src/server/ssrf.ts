import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateOrLoopbackIp(ip: string): boolean {
  const cleanIp = ip.replace(/^::ffff:/i, '');

  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local / cloud metadata 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(cleanIp)) {
    const lower = cleanIp.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    return false;
  }

  return true;
}

export async function assertSafeExternalUrl(
  rawUrl: string,
  options: { allowPrivateForLocalTest?: boolean } = {}
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are permitted.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials in URLs are not permitted.');
  }

  const host = parsed.hostname.toLowerCase();
  const allowPrivate =
    options.allowPrivateForLocalTest === true &&
    process.env.ALLOW_PRIVATE_CONNECTORS === 'true';

  if (!allowPrivate) {
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === 'metadata.google.internal'
    ) {
      throw new Error('Access to localhost or internal hostnames is blocked for SSRF safety.');
    }

    if (net.isIP(host)) {
      if (isPrivateOrLoopbackIp(host)) {
        throw new Error('Access to private, loopback, or metadata IP addresses is blocked.');
      }
      return parsed;
    }

    try {
      const addresses = await dns.lookup(host, { all: true });
      if (!addresses.length) {
        throw new Error(`Could not resolve hostname "${host}".`);
      }
      for (const addr of addresses) {
        if (isPrivateOrLoopbackIp(addr.address)) {
          throw new Error(
            `Hostname "${host}" resolved to a restricted private or loopback IP address.`
          );
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('restricted')) {
        throw err;
      }
      throw new Error(
        `DNS verification failed for "${host}": ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  return parsed;
}
