import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import { AccessGate } from "../components/common/AccessGate";

/**
 * PI WEB's React application.
 *
 * The gate is checked before the shell: a page whose origin wants a sign-in
 * paints the sign-in surface and keeps the workspace closed, exactly as the app
 * has always done. Everything behind the gate is the three-column workspace.
 */
export function App(): ReactNode {
  return (
    <AccessGate>
      <AppShell />
    </AccessGate>
  );
}
