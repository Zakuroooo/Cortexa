/**
 * Small CSV helpers for table artifacts.
 * The agent writes CSV; we parse it to preview it and to build the XLSX file.
 */

/** Parse CSV text into rows. Handles quoted fields, "" escapes and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * A cell that starts with = + - @ is run as a formula by Excel. A malicious web
 * page could get "=HYPERLINK(...)" into a table, so we prefix those with '.
 * (Same guard as the FollowUp CSV export.)
 */
export function guardFormula(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const v = guardFormula(cell);
          return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(",")
    )
    .join("\n");
}

/** Clean what the model wrote: strip ``` fences, re-serialise with the formula guard. */
export function normaliseCsv(text: string): string {
  const stripped = text.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  return toCsv(parseCsv(stripped));
}
