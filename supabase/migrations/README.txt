
Apply in this order:

1) 001_app_tables.sql
   Creates conversations + messages and RLS for the chat UI only.

2) 002_conversations_delete_policy.sql
   Allows users to delete their own conversations (messages cascade via FK).

3) Load Northwind sample data (required before 003)
   northwind.sql (bundled in this folder), or an external load such as
   https://github.com/pthom/northwind_psql
   NL→SQL and dashboard metrics need Northwind (or compatible) tables.

4) 003_datatalk_semantic_views.sql
   Semantic view datatalk_order_details_extended (joins order lines to product/category).

5) 004_datatalk_semantic_view_security_invoker.sql
   Ensures security_invoker on that view (Supabase / PG15+).

6) 005_conversation_memory_state.sql
   Adds memory_state jsonb on conversations for multi-turn hints.
