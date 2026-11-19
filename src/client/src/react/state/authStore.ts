import { createStore } from "./store";
import type { AuthDialogState } from "../../appState";

/**
 * The sign-in surface's state.
 *
 * The app's `AuthController` drives an app-state `authDialog` and the flows
 * behind it; the React shell mirrors what the controller writes into this store
 * and renders the same `auth-dialog` element from it. Keeping the store free of
 * the controller is what lets the plugin layer own the wiring: the controller
 * needs the whole projected app state, which is a plugin-layer concern.
 */
export interface AuthState {
  readonly dialog: AuthDialogState | undefined;
}

export const authStore = createStore<AuthState>({ dialog: undefined });


export function setAuthDialog(dialog: AuthDialogState | undefined): void {
  authStore.set({ dialog });
}
