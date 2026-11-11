"use client";

import type { ComponentProps } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
// Bundled TopoJSON: the map works offline and makes no tile requests.
import world from "world-atlas/countries-110m.json";
import { formatValue, humanize } from "@/lib/format";
import type { ChartSpec } from "@/lib/chart-spec";
import type { QueryResult } from "@/lib/types";

type Pt = { lon: number; lat: number; size: number; label: string };

/** x = longitude column, y[0] = latitude, y[1] = optional size, series = optional label column. */
export function GeoMap({ spec, result }: { spec: ChartSpec; result: QueryResult }) {
  const lonCol = spec.x!;
  const [latCol, sizeCol] = spec.y;

  const pts: Pt[] = [];
  for (const r of result.rows) {
    const lon = Number(r[lonCol]);
    const lat = Number(r[latCol]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    pts.push({
      lon,
      lat,
      size: sizeCol ? Number(r[sizeCol] ?? 0) : 0,
      label: spec.series ? String(r[spec.series] ?? "") : "",
    });
  }
  if (!pts.length)
    return <p className="py-10 text-center text-sm text-muted-foreground">No valid coordinates in this result.</p>;

  // Fit the map to the data unless it spans most of the world.
  const lons = pts.map((p) => p.lon);
  const lats = pts.map((p) => p.lat);
  const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const lonSpan = Math.max((maxLon - minLon) * 1.4, 12);
  const latSpan = Math.max((maxLat - minLat) * 1.4, 8);
  const world_ = maxLon - minLon > 120;
  const W = 800;
  const H = 420;
  const scale = Math.min((W * 180) / (Math.PI * lonSpan), (H * 180) / (Math.PI * latSpan * 1.3));

  const maxSize = Math.max(...pts.map((p) => p.size), 0);
  // The 800px viewBox renders ~2-3x smaller, so radii are in viewBox units (>= 8px on screen).
  const radius = (p: Pt) => (maxSize > 0 ? 9 + (Math.max(p.size, 0) / maxSize) * 16 : 12);

  return (
    <div className="overflow-hidden rounded-lg border bg-[color-mix(in_oklab,var(--seq-lo)_45%,var(--card))]">
      <ComposableMap
        width={W}
        height={H}
        projection={world_ ? "geoEqualEarth" : "geoMercator"}
        projectionConfig={world_ ? { scale: 150 } : { center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2], scale }}
        style={{ width: "100%", height: "auto" }}
      >
        {/* The runtime accepts a TopoJSON Topology (it uses the first object, "countries");
            the shipped typings only list GeoJSON / URL strings. */}
        <Geographies geography={world as unknown as ComponentProps<typeof Geographies>["geography"]}>
          {({ geographies }) =>
            geographies.map((g) => (
              <Geography
                key={g.rsmKey}
                geography={g}
                fill="var(--secondary)"
                stroke="var(--card)"
                strokeWidth={0.6}
                className="outline-none"
              />
            ))
          }
        </Geographies>
        {pts.map((p, i) => (
          <Marker key={i} coordinates={[p.lon, p.lat]}>
            <circle r={radius(p)} fill="var(--chart-1)" fillOpacity={0.85} stroke="var(--card)" strokeWidth={4}>
              <title>
                {[p.label, sizeCol ? `${humanize(sizeCol)}: ${formatValue(p.size)}` : "", `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </title>
            </circle>
          </Marker>
        ))}
      </ComposableMap>
    </div>
  );
}
