import type { ReactNode } from 'react';
import { PRODUCT_LOGO_SRC, PRODUCT_NAME } from '@ethesis/shared';

function resolveLogo(url?: string | null) {
  if (!url) return PRODUCT_LOGO_SRC;
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  return `/api/uploads/${url}`;
}

export function BrandBar({
  logoUrl,
  title,
  left,
  right,
}: {
  logoUrl?: string | null;
  title: string;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="brand-bar">
      <div className="brand-bar-left">
        {left}
        <img
          className="brand-bar-logo"
          src={resolveLogo(logoUrl)}
          alt={title || PRODUCT_NAME}
          onError={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            if (!el.src.includes(PRODUCT_LOGO_SRC)) {
              el.src = PRODUCT_LOGO_SRC;
            }
          }}
        />
      </div>
      <div className="brand-bar-center">{title}</div>
      <div className="brand-bar-right">{right}</div>
    </header>
  );
}
