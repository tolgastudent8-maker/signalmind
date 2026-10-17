/** Headline → OKX TR ticker tagging (no LLM): known project names plus explicit uppercase tickers. */

/** Common names → ticker for headline tagging (only symbols tradable on OKX TR are kept). */
export const NAMES: Record<string, string> = {
  bitcoin: "BTC",
  btc: "BTC",
  ethereum: "ETH",
  ether: "ETH",
  solana: "SOL",
  ripple: "XRP",
  xrp: "XRP",
  cardano: "ADA",
  dogecoin: "DOGE",
  doge: "DOGE",
  avalanche: "AVAX",
  chainlink: "LINK",
  polkadot: "DOT",
  litecoin: "LTC",
  "shiba inu": "SHIB",
  toncoin: "TON",
  tron: "TRX",
  sui: "SUI",
  aptos: "APT",
  arbitrum: "ARB",
  optimism: "OP",
  celestia: "TIA",
  near: "NEAR",
  uniswap: "UNI",
  aave: "AAVE",
  pepe: "PEPE",
  hyperliquid: "HYPE",
  ethena: "ENA",
  layerzero: "ZRO",
  starknet: "STRK",
  filecoin: "FIL",
  stellar: "XLM",
  hedera: "HBAR",
  injective: "INJ",
  worldcoin: "WLD",
  bonk: "BONK",
  okb: "OKB",
  zcash: "ZEC",
  "pudgy penguins": "PENGU",
  render: "RENDER",
};

export function tagTokens(text: string, universe: Set<string>): string[] {
  const found = new Set<string>();
  const lower = ` ${text.toLowerCase()} `;
  for (const [name, sym] of Object.entries(NAMES)) {
    if (universe.has(sym) && new RegExp(`[^a-z0-9]${name.replace(/ /g, "\\s")}[^a-z0-9]`).test(lower)) found.add(sym);
  }
  // Explicit uppercase tickers in the headline (e.g. "ZEC jumps 11%").
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{2,6}\b/g)) if (universe.has(m[0])) found.add(m[0]);
  return [...found].slice(0, 4);
}
