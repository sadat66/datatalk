import { cache } from "react";

import { getUserOrClearSession } from "./get-user";
import { createClient, hasSupabaseEnv } from "./server";

/** Dedupes `auth.getUser()` within a single RSC request (layout + pages). */
export const getAuthUser = cache(async () => {
  if (!hasSupabaseEnv()) {
    return null;
  }
  const supabase = await createClient();
  return getUserOrClearSession(supabase);
});
