/**
 * Allowlisted Northwind tables and columns (PostgreSQL `public` schema).
 * Aligned with the linked Supabase project via `information_schema.columns`
 * (Northwind from pthom/northwind_psql: table `region` singular, plus `us_states`, customer demo tables).
 */
export const NORTHWIND_TABLE_COLUMNS: Record<string, readonly string[]> = {
  customers: [
    "customer_id",
    "company_name",
    "contact_name",
    "contact_title",
    "address",
    "city",
    "region",
    "postal_code",
    "country",
    "phone",
    "fax",
  ],
  orders: [
    "order_id",
    "customer_id",
    "employee_id",
    "order_date",
    "required_date",
    "shipped_date",
    "ship_via",
    "freight",
    "ship_name",
    "ship_address",
    "ship_city",
    "ship_region",
    "ship_postal_code",
    "ship_country",
  ],
  order_details: ["order_id", "product_id", "unit_price", "quantity", "discount"],
  products: [
    "product_id",
    "product_name",
    "supplier_id",
    "category_id",
    "quantity_per_unit",
    "unit_price",
    "units_in_stock",
    "units_on_order",
    "reorder_level",
    "discontinued",
  ],
  categories: ["category_id", "category_name", "description", "picture"],
  suppliers: [
    "supplier_id",
    "company_name",
    "contact_name",
    "contact_title",
    "address",
    "city",
    "region",
    "postal_code",
    "country",
    "phone",
    "fax",
    "homepage",
  ],
  employees: [
    "employee_id",
    "last_name",
    "first_name",
    "title",
    "title_of_courtesy",
    "birth_date",
    "hire_date",
    "address",
    "city",
    "region",
    "postal_code",
    "country",
    "home_phone",
    "extension",
    "photo",
    "notes",
    "reports_to",
    "photo_path",
  ],
  shippers: ["shipper_id", "company_name", "phone"],
  /** Northwind dump uses singular `region`, not `regions`. */
  region: ["region_id", "region_description"],
  territories: ["territory_id", "territory_description", "region_id"],
  employee_territories: ["employee_id", "territory_id"],
  us_states: ["state_id", "state_name", "state_abbr", "state_region"],
  customer_customer_demo: ["customer_id", "customer_type_id"],
  customer_demographics: ["customer_type_id", "customer_desc"],
  /**
   * Curated join of orders × order_lines × products × categories — use instead of manual 4-way joins when possible.
   * Backed by `datatalk_order_details_extended` view in the database.
   */
  datatalk_order_details_extended: [
    "order_id",
    "product_id",
    "unit_price",
    "quantity",
    "discount",
    "order_date",
    "customer_id",
    "order_freight",
    "product_name",
    "units_in_stock",
    "discontinued",
    "category_id",
    "category_name",
  ],
} as const;

export const NORTHWIND_TABLES = Object.keys(NORTHWIND_TABLE_COLUMNS) as (keyof typeof NORTHWIND_TABLE_COLUMNS)[];

export function buildSchemaPromptExcerpt(): string {
  const lines: string[] = [];
  for (const table of NORTHWIND_TABLES) {
    const cols = NORTHWIND_TABLE_COLUMNS[table];
    lines.push(`${table}: ${cols.join(", ")}`);
  }
  return lines.join("\n");
}

/** Short typing hints so the model does not mis-handle booleans and money fields. */
export function buildColumnSemanticsHint(): string {
  return [
    "Column semantics: order_details.unit_price is numeric; quantity is integer; discount is a fraction 0–1.",
    "products.discontinued is 0/1 (treat as boolean filter). products.units_in_stock / units_on_order / reorder_level are integers.",
    "orders.order_date and other *date fields are date/timestamp; Northwind sample years are mostly 1996–1998.",
    "Revenue for a line is typically unit_price * quantity * (1 - discount).",
  ].join("\n");
}

export function buildSqlWhitelist(): { tables: string[]; columns: string[] } {
  const tables = NORTHWIND_TABLES.map((t) => `select::null::${t}`);
  const columns: string[] = ["select::null::(.*)"];
  for (const table of NORTHWIND_TABLES) {
    for (const col of NORTHWIND_TABLE_COLUMNS[table]) {
      columns.push(`select::${table}::${col}`);
    }
  }
  return { tables, columns };
}
