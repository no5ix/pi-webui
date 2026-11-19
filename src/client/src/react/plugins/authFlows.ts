import { AuthController } from "../../controllers/authController";
import { openLayer } from "../state/panels";
import { setAuthDialog } from "../state/authStore";
import { pushToast } from "../components/common/Toasts";
import { pluginAppState } from "./appStateProjection";

/**
 * The auth flows, run by the app's own controller.
 *
 * `configureAuth`, `logoutAuth` and the access gate all need the provider list,
 * the OAuth flow, its polling, and the logout - the app's `AuthController` owns
 * that, and it is fed the projected app state and told where to write. The
 * `auth-dialog` element the shell hosts is fully controlled, so the React layer
 * supplies the state and these handlers, exactly as the Lit shell did.
 */
const controller = new AuthController(
  () => pluginAppState(),
  (patch) => {
    if (patch.authDialog !== undefined) {
      setAuthDialog(patch.authDialog);
      return;
    }
    if (typeof patch.error === "string" && patch.error !== "") {
      pushToast({ body: patch.error, title: "The machine answered", tone: "error" });
    }
  },
  () => undefined,
  {
    noteDialogOpening: () => {
      openLayer("auth");
    },
  },
);

export function openSignIn(providerId?: string): void {
  void controller.openLogin(providerId);
}

export function openSignOut(): void {
  void controller.openLogout();
}


/** The dialog's state as the shell last heard it, for the hosted element. */

