/**
 * Node's built-in fetch (Undici) uses automatic dual-stack connection racing by default. On some
 * macOS networks with no usable IPv6 route, that strategy can leave outbound requests hanging even
 * though an IPv4 TCP/TLS connection works. The native https client with family: 4 succeeds on those
 * same hosts.
 *
 * Keep this transport scoped to ntfy: do not change the process-wide fetch dispatcher or the network
 * behavior of unrelated API calls. IPv4 is selected explicitly because ntfy servers are ordinary
 * HTTPS endpoints and the session daemon must be able to publish from IPv4-only networks.
 */
import { Agent, fetch as undiciFetch } from "undici";

const ntfyDispatcher = new Agent({
  connect: {
    family: 4,
    autoSelectFamily: false,
  },
});

/** Fetch implementation for ntfy publishes, using a dedicated IPv4 connection pool. */
export const ntfyFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  return undiciFetch(input, {
    ...init,
    dispatcher: ntfyDispatcher,
  }) as Promise<Response>;
}) as typeof fetch;
