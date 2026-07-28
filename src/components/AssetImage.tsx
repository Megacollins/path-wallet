// Renders a real image asset when it exists; on a 404 (or load error) it renders
// the procedural fallback instead. Lets us ship a photoreal look the moment the
// designer drops files into /public/textures — with no broken images meanwhile.
import { useState, type CSSProperties, type ReactNode } from "react";

export function AssetImage({
  src,
  alt = "",
  className,
  style,
  fallback = null,
}: {
  src: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img src={src} alt={alt} className={className} style={style} onError={() => setFailed(true)} draggable={false} />;
}
