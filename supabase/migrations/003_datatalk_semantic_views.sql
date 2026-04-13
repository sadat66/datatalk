-- Semantic layer: pre-joined views for safer NL→SQL (fewer join mistakes).

create or replace view public.datatalk_order_details_extended as
select
  od.order_id,
  od.product_id,
  od.unit_price,
  od.quantity,
  od.discount,
  o.order_date,
  o.customer_id,
  o.freight as order_freight,
  p.product_name,
  p.units_in_stock,
  p.discontinued,
  c.category_id,
  c.category_name
from public.order_details od
join public.orders o on o.order_id = od.order_id
join public.products p on p.product_id = od.product_id
join public.categories c on c.category_id = p.category_id;

comment on view public.datatalk_order_details_extended is
  'DataTalk semantic layer: order line with product and category for analytics. Prefer for line-level revenue queries.';
