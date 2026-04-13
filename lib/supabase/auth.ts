import { cache } from "react";

import { createClient } from "./server";

/** Dedupes `auth.getUser()` within a single RSC request (layout + pages). */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
