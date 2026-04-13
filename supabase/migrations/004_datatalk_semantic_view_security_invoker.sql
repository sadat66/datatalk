-- If 003 ran before security_invoker was set, apply the same fix (PG15+ / Supabase).
-- Resolves linter: public view in API schema should not behave as security definer.
alter view public.datatalk_order_details_extended set (security_invoker = true);
