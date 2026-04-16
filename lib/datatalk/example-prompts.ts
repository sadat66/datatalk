/** Shared copy for “try asking” chips (chat) and dashboard links — keep labels short for mobile. */
export type ExamplePrompt = { id: string; label: string; text: string };

export const EXAMPLE_CHAT_PROMPTS: ExamplePrompt[] = [
  {
    id: "top-customers",
    label: "Top customers",
    text: "Top 5 customers by revenue in 1997",
  },
  {
    id: "revenue-category",
    label: "Revenue by category",
    text: "Revenue by product category for 1997, highest first",
  },
  {
    id: "orders-month",
    label: "Orders by month",
    text: "Monthly order counts in 1997",
  },
  {
    id: "freight-shippers",
    label: "Freight by shipper",
    text: "Average freight cost by shipper in 1997",
  },
  {
    id: "supplier-products",
    label: "Products per supplier",
    text: "How many distinct products does each supplier offer?",
  },
  {
    id: "regional-orders",
    label: "Orders by region",
    text: "Order count by sales region for 1997",
  },
];
