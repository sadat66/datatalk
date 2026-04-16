import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Runs `auth.getUser()` and, when the refresh token is missing or invalid,
 * signs out so stale cookies are cleared. Prevents repeated refresh attempts
 * and log spam (`refresh_token_not_found`).
 */
export async function getUserOrClearSession(supabase: SupabaseClient): Promise<User | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error?.code === "refresh_token_not_found") {
    await supabase.auth.signOut();
    return null;
  }

  return user;
}
