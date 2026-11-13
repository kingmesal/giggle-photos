/**
 * The XMP sidecar document (RFD-007): standard tags that Immich, Lightroom and digiKam read, plus
 * a `giggle:Fields` attribute holding the same fields (with their sources) as JSON, so the app can
 * merge into its own sidecars without parsing arbitrary XMP. A sidecar without that attribute was
 * written by another app and is never touched.
 */
import { FIELD_KEYS, type Gps, type XmpFields } from "./xmp-fields";

export const CREATOR_TOOL = "Giggle Photos";
const GIGGLE_NS = "https://github.com/kingmesal/giggle-photos/ns/1.0/";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unescapeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

/** XMP GPS coordinate: "DDD,MM.mmmmmmK" (degrees, decimal minutes, hemisphere). */
export function xmpCoordinate(value: number, axis: "lat" | "lon"): string {
  const ref = axis === "lat" ? (value < 0 ? "S" : "N") : value < 0 ? "W" : "E";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${deg},${min.toFixed(6)}${ref}`;
}

function gpsAttributes(gps: Gps): string[] {
  const attrs = [
    `exif:GPSLatitude="${xmpCoordinate(gps.lat, "lat")}"`,
    `exif:GPSLongitude="${xmpCoordinate(gps.lon, "lon")}"`,
  ];
  if (gps.alt !== undefined && Number.isFinite(gps.alt)) {
    attrs.push(`exif:GPSAltitude="${Math.round(Math.abs(gps.alt) * 100)}/100"`);
    attrs.push(`exif:GPSAltitudeRef="${gps.alt < 0 ? 1 : 0}"`);
  }
  return attrs;
}

/** Render the sidecar for a field set. Pure. */
export function renderXmp(fields: XmpFields): string {
  const attrs: string[] = [`xmp:CreatorTool="${CREATOR_TOOL}"`];
  const elements: string[] = [];
  if (fields.dateTaken) {
    const d = escapeXml(fields.dateTaken.value);
    attrs.push(`exif:DateTimeOriginal="${d}"`, `xmp:CreateDate="${d}"`, `photoshop:DateCreated="${d}"`);
  }
  if (fields.gps) attrs.push(...gpsAttributes(fields.gps.value));
  if (fields.rating) attrs.push(`xmp:Rating="${fields.rating.value}"`);
  if (fields.cameraMake) attrs.push(`tiff:Make="${escapeXml(fields.cameraMake.value)}"`);
  if (fields.cameraModel) attrs.push(`tiff:Model="${escapeXml(fields.cameraModel.value)}"`);
  if (fields.description) {
    elements.push(
      `   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(fields.description.value)}</rdf:li></rdf:Alt></dc:description>`,
    );
  }
  if (fields.people && fields.people.value.length > 0) {
    const items = fields.people.value.map((p) => `<rdf:li>${escapeXml(p)}</rdf:li>`).join("");
    elements.push(`   <Iptc4xmpExt:PersonInImage><rdf:Bag>${items}</rdf:Bag></Iptc4xmpExt:PersonInImage>`);
  }
  const stored = Object.fromEntries(FIELD_KEYS.filter((k) => fields[k]).map((k) => [k, fields[k]]));
  attrs.push(`giggle:Fields="${escapeXml(JSON.stringify(stored))}"`);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${CREATOR_TOOL}">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmlns:giggle="${GIGGLE_NS}"
    ${attrs.join("\n    ")}>
${elements.join("\n")}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
}

/** Read a sidecar: our fields, or `foreign` when another app wrote it. */
export function parseXmp(text: string): { ours: true; fields: XmpFields } | { ours: false } {
  const m = /giggle:Fields="([^"]*)"/.exec(text);
  if (!m?.[1] && !text.includes(`xmp:CreatorTool="${CREATOR_TOOL}"`)) return { ours: false };
  if (!m?.[1]) return { ours: true, fields: {} }; // an early sidecar of ours (date only, no field copy)
  try {
    return { ours: true, fields: JSON.parse(unescapeXml(m[1])) as XmpFields };
  } catch {
    return { ours: false }; // damaged: leave it alone
  }
}
