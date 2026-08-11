# Grafické podklady

Každá sada kariet pridaná do `public/cards/` musí mať tu záznam o pôvode a licencii.
Bez záznamu sa sada nesmie zlúčiť do `main`.

## Formát sady

Zabudované témy: `src/client/cards/decks/<theme>/<kód>.svg`.
Sú **pod `src/`, nie pod `public/`**, aby ich Vite pretiahol modulovým grafom — chýbajúci
alebo preklepnutý súbor tak zhodí build namiesto toho, aby sa uprostred hry ukázal
rozbitý obrázok. Grafika dodaná až na server za behu ide do `public/cards/custom/`.

Kód má vždy 2 znaky:

- hodnota: `2 3 4 5 6 7 8 9 T J Q K A` (`T` = desiatka)
- farba: `C` (♣ krížy), `D` (♦ kára), `H` (♥ srdcia), `S` (♠ piky)

Príklady: `AS.svg`, `TH.svg`, `6C.svg`. Navyše `back.svg` (rub). Voliteľne `theme.json`.

Herný kód sa nikdy nedotýka názvov súborov — všetko ide cez
`src/client/cards/assets.ts` a komponent `CardFace`. Výmena grafiky je preto
nakopírovanie 53 súborov a jeden riadok v zozname tém, nie zásah do kódu.

## Použité sady

### `classic` — Tek Eye SVG Playing Cards

- Autor: Daniel S. Fowler, https://tekeye.uk
- Zdroj: https://www.tekeye.uk/playing_cards/svg-playing-cards
  (archív https://www.tekeye.uk/downloads/svg_playing_cards.zip)
- Licencia: **CC0 1.0 Universal / Public Domain**.
  Nie je to len tvrdenie na stránke — dedikácia je zapísaná priamo v RDF metadátach
  súborov: `<cc:license rdf:resource="http://creativecommons.org/publicdomain/zero/1.0/" />`
  a `<dc:rights><cc:Agent><dc:title>Public Domain</dc:title>`.
- Atribúcia: CC0 ju nevyžaduje. Uvádzame ju tu a v pätičke aplikácie, lebo sa patrí.
- Obsah archívu: 54 líc (52 kariet + 2 žolíky), 12 rubov, prázdna šablóna, PNG verzie.
  Importujeme 52 kariet + rub `blue.svg`.
- Overené 2026-08-11: 51 z 54 líc nesie explicitný CC0 odkaz; `diamonds_4` a `hearts_3`
  majú `dc:rights = Public Domain` bez odkazu na CC0, `diamonds_3` má metadáta odstránené.
  Všetky tri sú bežné číselné karty z inak jednotne CC0 sady a kryje ich aj plošné
  vyhlásenie autora na stránke — zjavné opomenutie, nie iná licencia.

Import (reprodukovateľný, výstup je commitnutý):

```bash
curl -LO https://www.tekeye.uk/downloads/svg_playing_cards.zip
unzip svg_playing_cards.zip -d /tmp/cards
pnpm tsx tools/import-cards.ts /tmp/cards/svg_playing_cards --theme classic
```

Importér premenúva na 2-znakovú konvenciu, **dopĺňa chýbajúci `viewBox`** (zdrojové
súbory majú len `width`/`height`, takže by neškálovali), odstraňuje pevné rozmery,
prepúšťa súbory cez svgo a vkladá hlavičku s pôvodom. Výsledok: 1,15 MB, 429 KB po gzipe.

### Záložná možnosť — CardMeister

- Zdroj: https://github.com/cardmeister/cardmeister.github.io
- Licencia: **Unlicense** (výslovné venovanie do public domain, bez akýchkoľvek podmienok).
- Obsah: 52 kariet generovaných procedurálne, rub cez atribút. Bez žolíkov.
- Použije sa, ak by sa pôvod sady `classic` ukázal ako sporný.

### Vlastná grafika (`custom`)

Grafiku dodanú neskôr stačí nakopírovať do `public/cards/custom/` priamo na server —
ak tam existuje `theme.json`, klient si tému zaregistruje za behu bez rebuildu.
Priečinok je v `.gitignore`, aby sa cudzia grafika neomylom necommitla.
