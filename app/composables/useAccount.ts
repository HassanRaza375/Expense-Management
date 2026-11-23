// The signed-in account, as the browser sees it. One shared state for the Account page, the Settings card and the sidebar.
//
// GUEST MODE IS TODAY'S APP: while the sync flag is off, `refresh()` does nothing and no function here calls the server. Signed out, nothing is stored about the account.
// The session is the server's cookie; the browser keeps no password and no token. Data on this device is never touched by signing in, out or deleting the account (Phase 5 adds sync).
import { reactive, readonly } from "vue";
import { useRuntimeConfig } from "#imports";
import { ApiError, apiFetch, jsonInit } from "../lib/account/api";
import { isSyncOn } from "../lib/sync/flag";

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
}

export interface Features {
  google: boolean;
  email: boolean;
  passwordMin: number;
}

export type AccountStatus = "off" | "idle" | "loading" | "signedOut" | "signedIn" | "offline" | "unavailable";

const state = reactive<{ status: AccountStatus; profile: Profile | null; features: Features; featuresKnown: boolean }>({
  status: "idle",
  profile: null,
  features: { google: false, email: false, passwordMin: 10 },
  featuresKnown: false,
});

/** True when accounts are turned on in this build (the public flag). */
export function accountsEnabled(): boolean {
  try {
    return isSyncOn(useRuntimeConfig().public.syncEnabled);
  } catch {
    return false;
  }
}

let inflight: Promise<void> | null = null;

/** Asks the server who is signed in. Off (no call at all) while the flag is off. */
export function refresh(): Promise<void> {
  if (!accountsEnabled()) {
    state.status = "off";
    state.profile = null;
    return Promise.resolve();
  }
  if (inflight) return inflight;
  state.status = state.profile ? state.status : "loading";
  inflight = (async () => {
    try {
      const r = await apiFetch<{ profile: Profile | null }>("/api/account/session");
      state.profile = r?.profile ?? null;
      state.status = state.profile ? "signedIn" : "signedOut";
    } catch (e) {
      state.profile = null;
      if (e instanceof ApiError && e.status === 0) state.status = "offline";
      else state.status = "unavailable";
    }
    if (!state.featuresKnown && (state.status === "signedOut" || state.status === "signedIn")) {
      try {
        state.features = await apiFetch<Features>("/api/account/status");
        state.featuresKnown = true;
      } catch {
        /* the page works with the defaults (everything optional off) */
      }
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function signUp(name: string, email: string, password: string): Promise<{ needsVerification: boolean }> {
  await apiFetch("/api/auth/sign-up/email", jsonInit("POST", { name: name.trim(), email: email.trim(), password }));
  await refresh();
  return { needsVerification: state.status !== "signedIn" };
}

export async function signIn(email: string, password: string): Promise<void> {
  await apiFetch("/api/auth/sign-in/email", jsonInit("POST", { email: email.trim(), password }));
  await refresh();
}

/** Starts Google sign-in (only offered when the server says it is configured). */
export async function signInWithGoogle(): Promise<void> {
  const r = await apiFetch<{ url?: string }>("/api/auth/sign-in/social", jsonInit("POST", { provider: "google", callbackURL: "/account" }));
  if (r?.url) window.location.assign(r.url);
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch("/api/auth/sign-out", jsonInit("POST", {}));
  } finally {
    state.profile = null;
    state.status = accountsEnabled() ? "signedOut" : "off";
  }
}

export async function updateName(name: string): Promise<void> {
  await apiFetch("/api/auth/update-user", jsonInit("POST", { name: name.trim() }));
  await refresh();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch("/api/auth/change-password", jsonInit("POST", { currentPassword, newPassword, revokeOtherSessions: true }));
}

export async function uploadAvatar(photo: Blob): Promise<void> {
  state.profile = await apiFetch<Profile>("/api/account/avatar", { method: "POST", headers: { "content-type": photo.type || "image/jpeg" }, body: photo });
}

export async function removeAvatar(): Promise<void> {
  state.profile = await apiFetch<Profile>("/api/account/avatar", { method: "DELETE" });
}

/** Deletes the account on the server (rows and files). The data on this device stays. */
export async function deleteAccount(confirm: string): Promise<void> {
  await apiFetch("/api/account", jsonInit("DELETE", { confirm }));
  state.profile = null;
  state.status = "signedOut";
}

export function useAccount() {
  return readonly(state);
}
