import { NextResponse } from 'next/server';
import { getCatalog, isSowCatalogEnabled, type CatalogResponse } from '@/lib/sowCatalog';

export const dynamic = 'force-dynamic';

/**
 * GET /api/catalog — the curated SOW Song Catalog (#50 curation rule), plus
 * the per-request feature-flag verdict (#56). The Catalog tab renders only
 * when `enabled` is true; when off the app is exactly today's.
 */
export async function GET() {
  if (!isSowCatalogEnabled()) {
    const body: CatalogResponse = { enabled: false, songs: [] };
    return NextResponse.json(body);
  }

  try {
    const songs = await getCatalog();
    const body: CatalogResponse = { enabled: true, songs };
    return NextResponse.json(body);
  } catch (err) {
    console.error('GET /api/catalog failed:', err);
    return NextResponse.json({ error: 'Failed to load catalog' }, { status: 500 });
  }
}
