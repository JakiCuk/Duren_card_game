# Grafické podklady

Každá sada kariet pridaná do `public/cards/` musí mať tu záznam o pôvode a licencii.
Bez záznamu sa sada nesmie zlúčiť do `main`.

## Formát sady

`public/cards/<theme>/<kód>.svg`, kde kód má vždy 2 znaky:

- hodnota: `2 3 4 5 6 7 8 9 T J Q K A` (`T` = desiatka)
- farba: `C` (♣ krížy), `D` (♦ kára), `H` (♥ srdcia), `S` (♠ piky)

Príklady: `AS.svg`, `TH.svg`, `6C.svg`. Navyše `back.svg` (rub). Voliteľne `theme.json`.

Herný kód sa nikdy nedotýka názvov súborov — všetko ide cez
`src/client/cards/assets.ts` a komponent `CardFace`. Výmena grafiky je preto
nakopírovanie 53 súborov, nie zásah do kódu.

## Použité sady

### `classic` — Tek Eye SVG Playing Cards

- Zdroj: https://www.tekeye.uk/playing_cards/svg-playing-cards
- Licencia: **public domain** — autor uvádza: „Despite tweaks to the pips and fonts,
  these vector playing cards are placed into the Public Domain."
- Atribúcia: nie je vyžadovaná, autor ju však oceňuje. Uvádzame ju tu aj v pätičke aplikácie.
- Obsah: 52 kariet + 2 žolíky + ruby + prázdna šablóna.
- Overené: 2026-08-11.

### Záložná možnosť — CardMeister

- Zdroj: https://github.com/cardmeister/cardmeister.github.io
- Licencia: **Unlicense** (výslovné venovanie do public domain, bez akýchkoľvek podmienok).
- Obsah: 52 kariet generovaných procedurálne, rub cez atribút. Bez žolíkov.
- Použije sa, ak by sa pôvod sady `classic` ukázal ako sporný.

### Vlastná grafika (`custom`)

Grafiku dodanú neskôr stačí nakopírovať do `public/cards/custom/` priamo na server —
ak tam existuje `theme.json`, klient si tému zaregistruje za behu bez rebuildu.
Priečinok je v `.gitignore`, aby sa cudzia grafika neomylom necommitla.
