// The reference's hero widget: the gold sculpture enshrined in a white-marble
// frame with a Roman mosaic border. Reuses the real sculpture photo (masked into
// a dark niche so its background disappears) with the Path monogram engraved.
import { useState } from "react";
import { GoldMedallion } from "./GoldMedallion";
import { PathMark } from "./Logo";

const MASK = "radial-gradient(76% 74% at 50% 46%, #000 42%, rgba(0,0,0,0.5) 64%, transparent 80%)";

export function SculptureWidget() {
  const [failed, setFailed] = useState(false);
  return (
    <div className="mosaic depth rounded-[1.6rem] p-2">
      <div className="marble-white gold-frame rounded-[1.25rem] p-2.5">
        <div
          className="niche relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[0.9rem]"
          style={{ background: "radial-gradient(80% 70% at 50% 40%, #241d10, #0b0906 78%)" }}
        >
          <div className="pointer-events-none absolute left-1/2 top-[42%] h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-champagne/25 blur-3xl" />
          {failed ? (
            <GoldMedallion size={132} />
          ) : (
            <>
              <img
                src="/textures/gold-sculpture.png"
                alt="Path"
                draggable={false}
                onError={() => setFailed(true)}
                className="relative h-[88%] w-auto animate-float object-contain"
                style={{ WebkitMaskImage: MASK, maskImage: MASK, filter: "drop-shadow(0 20px 30px rgba(0,0,0,0.8)) drop-shadow(0 0 40px rgba(201,162,39,0.35))" }}
              />
              <div
                className="pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2"
                style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.7)) drop-shadow(0 0 8px rgba(201,162,39,0.45))" }}
              >
                <PathMark size={62} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
