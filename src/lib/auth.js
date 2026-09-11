import { isSupabaseConfigured, supabase } from "./supabase";

export async function getSession() {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback) {
  if (!isSupabaseConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password, displayName) {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      // GitHub Pages hosts this app beneath /football-app/. Supplying the
      // precise current app URL prevents confirmation links from falling
      // back to a GitHub account root, which has no site to serve.
      emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString(),
    },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
}

export async function getApprovalStatus() {
  const { data, error } = await supabase.rpc("get_my_app_approval_status");
  if (error) throw error;
  return data;
}
