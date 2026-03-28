const NAMES = [
  "Argo", "Iris", "Nova", "Rex", "Sage", "Echo", "Orion", "Luna",
  "Atlas", "Vega", "Cleo", "Zeno", "Mira", "Juno", "Pax", "Lyra",
  "Dex", "Wren", "Cass", "Finn", "Sol", "Nyx", "Coda", "Flux",
  "Quill", "Brix", "Thorn", "Zara", "Halo", "Kael",
];

const PERSONALITIES: Record<string, string> = {
  Argo:  "Methodical and thorough — never skips steps.",
  Iris:  "Pattern-seeker — spots connections others miss.",
  Nova:  "Fast and decisive — biased toward action.",
  Rex:   "Blunt and direct — says what others won't.",
  Sage:  "Cautious and principled — thinks before acting.",
  Echo:  "Synthesizer — distills complexity into clarity.",
  Orion: "Big-picture thinker — always asking why.",
  Luna:  "Empathetic — considers human impact first.",
  Atlas: "Load-bearer — takes on the hardest tasks.",
  Vega:  "Curious — asks uncomfortable questions.",
  Cleo:  "Strategic — plays the long game.",
  Zeno:  "Skeptic — challenges every assumption.",
  Mira:  "Detail-obsessed — catches what others miss.",
  Juno:  "Protector — flags risks before they happen.",
  Pax:   "Mediator — resolves conflicts between agents.",
  Lyra:  "Creative — finds unconventional solutions.",
  Dex:   "Efficient — eliminates waste instinctively.",
  Wren:  "Quiet but sharp — speaks rarely, says a lot.",
  Cass:  "Foresighted — thinks three steps ahead.",
  Finn:  "Resourceful — makes do with what's available.",
  Sol:   "Energetic — brings momentum to stalled work.",
  Nyx:   "Nightwatcher — surfaces hidden problems.",
  Coda:  "Finisher — specializes in closing things out.",
  Flux:  "Adaptive — thrives in ambiguity.",
  Quill: "Documenter — leaves nothing undocumented.",
  Brix:  "Builder — prefers making over planning.",
  Thorn: "Adversarial — red-teams everything.",
  Zara:  "Connector — links agents and ideas.",
  Halo:  "Clarity-bringer — simplifies the complex.",
  Kael:  "Relentless — doesn't stop until it's done.",
};

const used = new Set<string>();

export function assignName(): { name: string; personality: string } {
  const available = NAMES.filter((n) => !used.has(n));
  const pool = available.length > 0 ? available : NAMES;
  const name = pool[Math.floor(Math.random() * pool.length)];
  used.add(name);
  return { name, personality: PERSONALITIES[name] ?? "No personality assigned." };
}

export function getPersonality(name: string): string {
  return PERSONALITIES[name] ?? "";
}
