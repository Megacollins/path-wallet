// Quick actions into the Rome ecosystem — real, verified destinations only.
import { motion } from "framer-motion";
import { ECOSYSTEM, chainLinks, type EcosystemLink } from "../../lib/apps";
import { cfg } from "../config";
import { Card, Eyebrow } from "../components/ui";

export function Apps() {
  const links = [...ECOSYSTEM, ...chainLinks(cfg.explorerUrl)];
  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>Built on the same state</Eyebrow>
        <h1 className="mt-1 font-serif text-3xl sm:text-4xl text-parchment">Ecosystem</h1>
        <p className="mt-1 max-w-2xl text-sm text-parchment/55">
          Live apps on Rome share accounts with Path — an LP or position minted elsewhere is already spendable here. Links open the official
          source.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link, i) => (
          <LinkCard key={link.name} link={link} index={i} />
        ))}
      </div>
    </div>
  );
}

function LinkCard({ link, index }: { link: EcosystemLink; index: number }) {
  return (
    <motion.a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.4) }}
      whileHover={{ y: -3 }}
      className="block"
    >
      <Card className="group h-full transition-shadow hover:shadow-gold">
        <div className="flex items-start justify-between">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-gold/20 bg-stone-800/60 text-2xl">{link.glyph}</div>
          <span className="chip !py-0.5 !text-[10px] !text-parchment/50">{link.target}</span>
        </div>
        <h3 className="mt-4 font-serif text-lg text-parchment group-hover:text-gold-100 transition">{link.name}</h3>
        <p className="mt-1 text-sm leading-relaxed text-parchment/50">{link.blurb}</p>
        <span className="mt-3 inline-flex items-center gap-1 text-xs text-gold-200/80">
          Open <span className="transition-transform group-hover:translate-x-0.5">↗</span>
        </span>
      </Card>
    </motion.a>
  );
}
