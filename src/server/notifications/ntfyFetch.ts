/**
 * Node's built-in fetch (Undici) uses automatic dual-stack connection racing by default. On some
 * macOS networks with no usable IPv6 route, that strategy can leave outbound requests hanging even
 * though an IPv4 TCP/TLS connection works. The native https client with family: 4 succeeds on those
 * same hosts.
 *
 * Keep this transport scoped to ntfy: do not change the process-wide fetch dispatcher or the network
 * behavior of unrelated API calls. IPv4 is selected explicitly because ntfy servers are ordinary
 * HTTPS endpoints and the session daemon must be able to publish from IPv4-only networks.
 *
 * The transport is typed as ntfy's own contract, not as `typeof fetch`: Undici's `Response` is a
 * different type from the global one the DOM lib declares, and the two only overlap on the members
 * the delivery decision reads. Naming that overlap is what keeps this assignment honest.
 */
import { Agent, fetch as undiciFetch } from "undici";
import type { NtfyFetch } from "../../shared/ntfy.js";

const ntfyDispatcher = new Agent({
  connect: {
    family: 4,
    autoSelectFamily: false,
  },
});

/** Fetch implementation for ntfy publishes, using a dedicated IPv4 connection pool. */
export const ntfyFetch: NtfyFetch = (input, init) => undiciFetch(input, {
  ...init,
  dispatcher: ntfyDispatcher,
});
