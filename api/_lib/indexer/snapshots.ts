// Wallet activity snapshots: a wallet's Rome transaction count (nonce) and gas balance, per chain,
// stored only when either changes. The nonce delta between two snapshots is how many transactions
// the wallet sent in that window — across every app on Rome, not just Path.
import { query } from "../db.js";
import type { IndexedNetwork } from "../networks.generated.js";
import { hexToNum, rpc } from "./rpc.js";

export async function snapshotAddress(address: string, networks: IndexedNetwork[]): Promise<{ inserted: number; errors: string[] }> {
  let inserted = 0;
  const errors: string[] = [];
  await Promise.all(
    networks.map(async (net) => {
      try {
        const [nonceHex, balHex] = await Promise.all([rpc<string>(net.proxyUrl, "eth_getTransactionCount", [address, "latest"]), rpc<string>(net.proxyUrl, "eth_getBalance", [address, "latest"])]);
        const nonce = hexToNum(nonceHex);
        const balance = BigInt(balHex).toString();
        const last = (await query(`select nonce, gas_balance from wallet_snapshots where address = $1 and chain_id = $2 order by taken_at desc, id desc limit 1`, [address, net.chainId]))[0];
        const same = last && Number(last.nonce) === nonce && String(last.gas_balance).split(".")[0] === balance;
        if (same) return;
        await query(`insert into wallet_snapshots (address, chain_id, nonce, gas_balance) values ($1, $2, $3, $4)`, [address, net.chainId, nonce, balance]);
        inserted++;
      } catch (e: any) {
        errors.push(`${net.chainName}: ${String(e?.message ?? e).slice(0, 120)}`);
      }
    }),
  );
  return { inserted, errors };
}
