import { useEffect, useState, type ReactNode } from "react";
import { accessGateOn } from "../../../accessGate";
import { LitBoundary } from "./LitBoundary";

/**
 * The gate in front of the workspace.
 *
 * A page whose origin has access control on does not read as an empty workspace:
 * the gate is checked first, and the sign-in surface the app always used is shown
 * over it. The gate flips on and off by itself — the machine turns access control
 * on while the page is open — so the shell listens for the flip both ways.
 */
export interface AccessGateProps {
  children: ReactNode;
}

export function AccessGate(props: AccessGateProps): ReactNode {
  const [gated, setGated] = useState<boolean>(() => accessGateOn());
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const sync = (): void => { setGated(accessGateOn()); };
    window.addEventListener("pi-web-access-gate-changed", sync);
    window.addEventListener("pi-web-sign-in-required", sync);
    const timer = window.setInterval(sync, 2000);
    sync();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pi-web-access-gate-changed", sync);
      window.removeEventListener("pi-web-sign-in-required", sync);
    };
  }, []);

  if (!gated) return props.children;

  return (
    <div className="piw-gate" data-testid="access-gate">
      <div className="piw-gate__card">
        <h1 className="piw-gate__title">Access is controlled here</h1>
        <p className="piw-gate__body">
          {"This PI WEB has access control turned on. Sign in and the workspace opens; nothing is read until you do."}
        </p>
        {signingIn ? (
          <LitBoundary
            onElement={(element) => {
              Reflect.set(element, "onCancel", () => { setSigningIn(false); });
            }}
            tag="auth-dialog"
          />
        ) : (
          <button className="piw-button piw-button--primary" onClick={() => { setSigningIn(true); }} type="button">
            Sign in
          </button>
        )}
      </div>
    </div>
  );
}
