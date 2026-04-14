import { unstable_cache } from "next/cache";
import postgres from "postgres";

import { getReadonlyDatabaseUrl } from "@/lib/datatalk/executor";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyFine = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export type DashboardDataset =
  | {
      ok: true;
      focusYear: number;
      compareYear: number;
      kpis: {
        totalRevenue: number;
        totalRevenueDeltaPct: number | null;
        avgOrderValue: number;
        avgOrderValueDeltaPct: number | null;
        ordersShipped: number;
        ordersShippedDeltaPct: number | null;
        newCustomers: number;
        newCustomersDeltaPct: number | null;
        revenueSpark: number[];
        avgOrderSpark: number[];
        shippedSpark: number[];
        customersSpark: number[];
      };
      revenueByMonth: {
        month: number;
        monthLabel: string;
        revenue: number;
        baselineRevenue: number;
        /** Line revenue for `historyYear` (same month alignment). */
        historyRevenue: number;
      }[];
      /** Prior-prior calendar year (e.g. 1996 when comparing 1998 vs 1997). */
      historyYear: number;
      lateOrders: { orderId: number; customer: string; shipper: string; daysLate: number; value: number }[];
      unfinishedOrders: { orderId: number; customer: string; status: "Open" | "Late"; value: number }[];
      anomalyCount: number;
      /** Human-readable definition of what increments `anomalyCount` (for tooltips). */
      anomalyExplanation: string;
    }
  | { ok: false; error: string };

function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function monthLabel(m: number): string {
  return new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "short" });
}

function sparkFromMonthly(values: number[], take = 12): number[] {
  const slice = values.slice(0, take);
  if (!slice.length) return [];
  const max = Math.max(...slice, 1);
  return slice.map((v) => Math.round((v / max) * 100) / 100);
}

async function loadDashboardDatasetFromDb(): Promise<DashboardDataset> {
  const url = getReadonlyDatabaseUrl();
  if (!url) {
    return {
      ok: false,
      error:
        "No database URL. Set DATABASE_URL_READONLY, DATABASE_TRANSACTION_URL, or DIRECT_DATABASE_URL in your environment.",
    };
  }

  const sql = postgres(url, { max: 1, prepare: false, connection: { statement_timeout: 8000 } });

  try {
    const yearRows = await sql<{ y: number }[]>`
      select distinct extract(year from order_date)::int as y
      from orders
      where order_date is not null
      order by y desc
    `;
    if (!yearRows.length) {
      return { ok: false, error: "No orders with order dates found in the database." };
    }

    const focusYear = yearRows[0]!.y;
    const compareYear = focusYear - 1;

    const lineRevenue = sql`
      select coalesce(sum(
        od.unit_price::double precision * od.quantity::double precision * (1 - coalesce(od.discount, 0)::double precision)
      ), 0)::double precision as revenue
      from order_details od
      join orders o on o.order_id = od.order_id
      where o.order_date is not null
        and extract(year from o.order_date) = ${focusYear}
    `;
    const lineRevenuePrev = sql`
      select coalesce(sum(
        od.unit_price::double precision * od.quantity::double precision * (1 - coalesce(od.discount, 0)::double precision)
      ), 0)::double precision as revenue
      from order_details od
      join orders o on o.order_id = od.order_id
      where o.order_date is not null
        and extract(year from o.order_date) = ${compareYear}
    `;

    const ordersShipped = sql`
      select count(*)::bigint as c
      from orders o
      where o.shipped_date is not null
        and extract(year from o.order_date) = ${focusYear}
    `;
    const ordersShippedPrev = sql`
      select count(*)::bigint as c
      from orders o
      where o.shipped_date is not null
        and extract(year from o.order_date) = ${compareYear}
    `;

    const orderCount = sql`
      select count(*)::bigint as c
      from orders o
      where o.order_date is not null
        and extract(year from o.order_date) = ${focusYear}
    `;
    const orderCountPrev = sql`
      select count(*)::bigint as c
      from orders o
      where o.order_date is not null
        and extract(year from o.order_date) = ${compareYear}
    `;

    const newCustomers = sql`
      with first_order as (
        select customer_id, min(order_date) as first_date
        from orders
        where customer_id is not null
        group by customer_id
      )
      select count(*)::bigint as c
      from first_order
      where extract(year from first_date) = ${focusYear}
    `;
    const newCustomersPrev = sql`
      with first_order as (
        select customer_id, min(order_date) as first_date
        from orders
        where customer_id is not null
        group by customer_id
      )
      select count(*)::bigint as c
      from first_order
      where extract(year from first_date) = ${compareYear}
    `;

    const monthlyFocus = await sql<{ m: number; revenue: string }[]>`
      select extract(month from o.order_date)::int as m,
        coalesce(sum(
          od.unit_price::double precision * od.quantity::double precision * (1 - coalesce(od.discount, 0)::double precision)
        ), 0)::text as revenue
      from order_details od
      join orders o on o.order_id = od.order_id
      where o.order_date is not null
        and extract(year from o.order_date) = ${focusYear}
      group by 1
      order by 1
    `;
    const monthlyCompare = await sql<{ m: number; revenue: string }[]>`
      select extract(month from o.order_date)::int as m,
        coalesce(sum(
          od.unit_price::double precision * od.quantity::double precision * (1 - coalesce(od.discount, 0)::double precision)
        ), 0)::text as revenue
      from order_details od
      join orders o on o.order_id = od.order_id
      where o.order_date is not null
        and extract(year from o.order_date) = ${compareYear}
      group by 1
      order by 1
    `;

    const historyYear = compareYear - 1;
    const monthlyHistory = await sql<{ m: number; revenue: string }[]>`
      select extract(month from o.order_date)::int as m,
        coalesce(sum(
          od.unit_price::double precision * od.quantity::double precision * (1 - coalesce(od.discount, 0)::double precision)
        ), 0)::text as revenue
      from order_details od
      join orders o on o.order_id = od.order_id
      where o.order_date is not null
        and extract(year from o.order_date) = ${historyYear}
      group by 1
      order by 1
    `;

    const monthlyOrderCounts = await sql<{ m: number; c: string }[]>`
      select extract(month from order_date)::int as m, count(*)::text as c
      from orders
      where order_date is not null
        and extract(year from order_date) = ${focusYear}
      group by 1
      order by 1
    `;
    const monthlyShippedCounts = await sql<{ m: number; c: string }[]>`
      select extract(month from order_date)::int as m, count(*)::text as c
      from orders
      where order_date is not null
        and shipped_date is not null
        and extract(year from order_date) = ${focusYear}
      group by 1
      order by 1
    `;
    const monthlyNewCustomerCounts = await sql<{ m: number; c: string }[]>`
      with first_order as (
        select customer_id, min(order_date) as first_date
        from orders
        where customer_id is not null
        group by customer_id
      )
      select extract(month from first_date)::int as m, count(*)::text as c
      from first_order
      where extract(year from first_date) = ${focusYear}
      group by 1
      order by 1
    `;

    const [
      revRow,
      revPrevRow,
      shipRow,
      shipPrevRow,
      ordRow,
      ordPrevRow,
      ncRow,
      ncPrevRow,
    ] = await Promise.all([
      lineRevenue,
      lineRevenuePrev,
      ordersShipped,
      ordersShippedPrev,
      orderCount,
      orderCountPrev,
      newCustomers,
      newCustomersPrev,
    ]);

    const totalRevenue = Number(revRow[0]?.revenue ?? 0);
    const totalRevenuePrev = Number(revPrevRow[0]?.revenue ?? 0);
    const shipped = Number(shipRow[0]?.c ?? 0);
    const shippedPrev = Number(shipPrevRow[0]?.c ?? 0);
    const orders = Number(ordRow[0]?.c ?? 0);
    const ordersPrev = Number(ordPrevRow[0]?.c ?? 0);
    const newCust = Number(ncRow[0]?.c ?? 0);
    const newCustPrev = Number(ncPrevRow[0]?.c ?? 0);

    const avgOrderValue = orders > 0 ? totalRevenue / orders : 0;
    const avgOrderValuePrev = ordersPrev > 0 ? totalRevenuePrev / ordersPrev : 0;

    const revByMonthMap = new Map(monthlyFocus.map((r) => [r.m, Number(r.revenue)]));
    const baseByMonthMap = new Map(monthlyCompare.map((r) => [r.m, Number(r.revenue)]));
    const historyByMonthMap = new Map(monthlyHistory.map((r) => [r.m, Number(r.revenue)]));
    const ordersByMonthMap = new Map(monthlyOrderCounts.map((r) => [r.m, Number(r.c)]));
    const shippedByMonthMap = new Map(monthlyShippedCounts.map((r) => [r.m, Number(r.c)]));
    const newCustByMonthMap = new Map(monthlyNewCustomerCounts.map((r) => [r.m, Number(r.c)]));

    const revenueByMonth: {
      month: number;
      monthLabel: string;
      revenue: number;
      baselineRevenue: number;
      historyRevenue: number;
    }[] = [];
    for (let m = 1; m <= 12; m += 1) {
      revenueByMonth.push({
        month: m,
        monthLabel: monthLabel(m),
        revenue: revByMonthMap.get(m) ?? 0,
        baselineRevenue: baseByMonthMap.get(m) ?? 0,
        historyRevenue: historyByMonthMap.get(m) ?? 0,
      });
    }

    const monthlyRevenueSeries = Array.from({ length: 12 }, (_, i) => revByMonthMap.get(i + 1) ?? 0);
    const monthlyAvgSeries = Array.from({ length: 12 }, (_, i) => {
      const rev = revByMonthMap.get(i + 1) ?? 0;
      const oc = ordersByMonthMap.get(i + 1) ?? 0;
      return oc > 0 ? rev / oc : 0;
    });
    const monthlyShippedSeries = Array.from({ length: 12 }, (_, i) => shippedByMonthMap.get(i + 1) ?? 0);
    const monthlyNewCustSeries = Array.from({ length: 12 }, (_, i) => newCustByMonthMap.get(i + 1) ?? 0);

    const lateOrdersRaw = await sql<{
      order_id: number;
      company_name: string | null;
      shipper: string | null;
      days_late: string;
      order_value: string;
    }[]>`
      select o.order_id,
        c.company_name,
        s.company_name as shipper,
        (o.shipped_date::date - o.required_date::date)::text as days_late,
        (
          select coalesce(sum(
            od2.unit_price::double precision * od2.quantity::double precision * (1 - coalesce(od2.discount, 0)::double precision)
          ), 0)::text
          from order_details od2
          where od2.order_id = o.order_id
        ) as order_value
      from orders o
      left join customers c on c.customer_id = o.customer_id
      left join shippers s on s.shipper_id = o.ship_via
      where o.shipped_date is not null
        and o.required_date is not null
        and o.shipped_date > o.required_date
      order by o.order_date desc nulls last
      limit 8
    `;

    const unfinishedRaw = await sql<{
      order_id: number;
      company_name: string | null;
      status: string;
      order_value: string;
    }[]>`
      select o.order_id,
        c.company_name,
        case when o.shipped_date is null then 'Open' else 'Late' end as status,
        (
          select coalesce(sum(
            od2.unit_price::double precision * od2.quantity::double precision * (1 - coalesce(od2.discount, 0)::double precision)
          ), 0)::text
          from order_details od2
          where od2.order_id = o.order_id
        ) as order_value
      from orders o
      left join customers c on c.customer_id = o.customer_id
      where (
          o.shipped_date is null
          or (o.shipped_date is not null and o.required_date is not null and o.shipped_date > o.required_date)
        )
        and extract(year from coalesce(o.shipped_date, o.order_date)) = ${focusYear}
      order by o.order_date desc nulls last
      limit 8
    `;

    const anomalyRow = await sql<{ c: string }[]>`
      select count(*)::text as c
      from orders o
      where extract(year from coalesce(o.shipped_date, o.order_date)) = ${focusYear}
        and (
          o.shipped_date is null
          or (o.shipped_date is not null and o.required_date is not null and o.shipped_date > o.required_date)
        )
    `;
    const anomalyCount = Number(anomalyRow[0]?.c ?? 0);
    const anomalyExplanation = `Orders in ${focusYear} (year from ship date when present, otherwise order date) that are still open (not shipped) or were shipped after the required date.`;

    return {
      ok: true,
      focusYear,
      compareYear,
      kpis: {
        totalRevenue,
        totalRevenueDeltaPct: pctDelta(totalRevenue, totalRevenuePrev),
        avgOrderValue,
        avgOrderValueDeltaPct: pctDelta(avgOrderValue, avgOrderValuePrev),
        ordersShipped: shipped,
        ordersShippedDeltaPct: pctDelta(shipped, shippedPrev),
        newCustomers: newCust,
        newCustomersDeltaPct: pctDelta(newCust, newCustPrev),
        revenueSpark: sparkFromMonthly(monthlyRevenueSeries),
        avgOrderSpark: sparkFromMonthly(monthlyAvgSeries.length ? monthlyAvgSeries : monthlyRevenueSeries),
        shippedSpark: sparkFromMonthly(monthlyShippedSeries.length ? monthlyShippedSeries : monthlyRevenueSeries),
        customersSpark: sparkFromMonthly(monthlyNewCustSeries.length ? monthlyNewCustSeries : monthlyRevenueSeries),
      },
      revenueByMonth,
      historyYear,
      lateOrders: lateOrdersRaw.map((r) => ({
        orderId: r.order_id,
        customer: r.company_name ?? "—",
        shipper: r.shipper ?? "—",
        daysLate: Math.max(0, Math.round(Number(r.days_late))),
        value: Number(r.order_value),
      })),
      unfinishedOrders: unfinishedRaw.map((r) => ({
        orderId: r.order_id,
        customer: r.company_name ?? "—",
        status: r.status === "Open" ? "Open" : "Late",
        value: Number(r.order_value),
      })),
      anomalyCount,
      anomalyExplanation,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

const getCachedDashboardDataset = unstable_cache(loadDashboardDatasetFromDb, ["northwind-dashboard-dataset-v3"], {
  revalidate: 120,
});

/** Loads Northwind aggregates for the dashboard (read-only SQL, server-only). Result is cached briefly to limit database load on repeated navigations. */
export async function getDashboardDataset(): Promise<DashboardDataset> {
  const url = getReadonlyDatabaseUrl();
  if (!url) {
    return {
      ok: false,
      error:
        "No database URL. Set DATABASE_URL_READONLY, DATABASE_TRANSACTION_URL, or DIRECT_DATABASE_URL in your environment.",
    };
  }
  return getCachedDashboardDataset();
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return money.format(0);
  if (Math.abs(amount) >= 1000) return money.format(amount);
  return moneyFine.format(amount);
}
