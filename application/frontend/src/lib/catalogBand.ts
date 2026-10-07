/**
 * The IW curation BPM band (#50, calibrated on staging via #58: 442 eligible
 * recordings — min 58.7, p25 66.3, p75 99.4, max 143.6). Shared by the BFF's
 * SQL filter (src/lib/sowCatalog.ts) and the Catalog tab's chip/filter
 * (src/components/CatalogBrowse.tsx) so the two cannot drift.
 */
export const SOW_CATALOG_BPM_BAND = Object.freeze({ min: 60, max: 100 });
