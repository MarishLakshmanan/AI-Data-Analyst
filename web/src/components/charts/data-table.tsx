"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatValue, humanize } from "@/lib/format";
import type { QueryResult } from "@/lib/types";

export function DataTable({ result, maxRows = 200 }: { result: QueryResult; maxRows?: number }) {
  const rows = result.rows.slice(0, maxRows);
  return (
    <ScrollArea className="h-72 rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
          <TableRow>
            {result.columns.map((c) => (
              <TableHead key={c.name} className={`h-8 text-xs font-medium whitespace-nowrap text-muted-foreground ${c.type === "number" ? "text-right" : ""}`}>
                {humanize(c.name)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {result.columns.map((c) => (
                <TableCell key={c.name} className={`py-1.5 text-xs ${c.type === "number" ? "text-right tabular-nums" : ""}`}>
                  {formatValue(r[c.name])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {result.rows.length > maxRows && (
        <p className="p-2 text-center text-xs text-muted-foreground">
          Showing {maxRows} of {result.rows.length} rows
        </p>
      )}
    </ScrollArea>
  );
}
