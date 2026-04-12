import { NORTHWIND_TABLE_COLUMNS, NORTHWIND_TABLES } from "@/lib/northwind/schema";
import { JOIN_RECIPES } from "@/lib/northwind/join-recipes";

const MAX_RECIPES = 3;
const MAX_TABLE_DIGESTS = 4;

function tableMentioned(table: string, haystack: string): boolean {
  return new RegExp(`\\b${table}\\b`, "i").test(haystack);
}

function scoreRecipe(haystack: string, lower: string): (r: (typeof JOIN_RECIPES)[number]) => number {
  return (recipe) => {
    let s = 0;
    for (const t of recipe.triggers) {
      if (tableMentioned(t, haystack)) s += 2;
    }
    for (const kw of recipe.keywords ?? []) {
      if (lower.includes(kw)) s += 1;
    }
    return s;
  };
}

/** Keyword retrieval: pick join recipes + compact column lists for tables hinted in text. */
export function retrieveSchemaSnippets(text: string): string {
  const haystack = text.trim();
  if (!haystack) return "";

  const lower = haystack.toLowerCase();

  const scored = JOIN_RECIPES.map((r) => ({ r, score: scoreRecipe(haystack, lower)(r) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECIPES)
    .map((x) => x.r);

  const tablesHit = NORTHWIND_TABLES.filter((t) => tableMentioned(t, haystack)).slice(0, MAX_TABLE_DIGESTS);

  const parts: string[] = [];
  if (tablesHit.length) {
    parts.push("Table columns (subset for tables you mentioned):");
    for (const t of tablesHit) {
      const cols = NORTHWIND_TABLE_COLUMNS[t];
      parts.push(`${t}: ${cols.join(", ")}`);
    }
  }
  if (scored.length) {
    parts.push("Join recipes (this turn):");
    for (const r of scored) {
      parts.push(`${r.title}: ${r.body}`);
    }
  }

  return parts.join("\n");
}
