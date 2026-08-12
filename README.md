# Durak

Webová kartová hra Durak — proti botom (4 úrovne zložitosti) aj proti živým hráčom online.

Jedna Node aplikácia: Fastify servíruje statický React build aj WebSocket. Bez databázy,
bez účtov — izby sa vytvárajú anonymne a zdieľajú kódom.

## Vývoj

```bash
pnpm install
pnpm dev          # Vite na :5173, Fastify na :3000 (Vite proxuje /ws a /api)
```

## Kontroly

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm sim -- --games 10000     # fuzzer herného jadra
pnpm sim -- --games 500 --bots 2,1   # to isté, ale hrajú boti
pnpm duel -- --a 2 --b 1 --games 2000  # sila botov na párovaných rozdaniach
pnpm sim -- --games 3000 --matrix true # náhodné kombinácie domácich pravidiel
```

## Pravidlá

Každá izba má vlastnú konfiguráciu (`RuleConfig`): 36 alebo 52 kariet, veľkosť ruky,
strop stola, limit útoku (podľa ruky obrancu / bez limitu / pevný), limit prihadzovania
po „beriem", kto smie prihadzovať (ktokoľvek / len susedia obrancu), prehadzovanie
(perevodnoy) vrátane reťazenia a prehodenia ukázaním tromfu, kto začína, či obranca
musí zbiť keď môže, a či je tromfová karta viditeľná.

`validateConfig` odmieta nedealovateľné kombinácie (36 kariet so 6 hráčmi) a varuje
pred tými, ktoré prekvapujú (napr. „obranca musí zbiť" mení hru viac, než sa zdá).

**Hra vždy skončí.** Durak vie cyklovať — traja hráči, z ktorých každý nevie zbiť
útok toho ďalšieho, si môžu kartu podávať dokola donekonečna. Ľudia to prelomia tým,
že zahrajú inak; deterministickí boti nie a serverová izba by zamrzla. Preto je
`MAX_BOUTS_WITHOUT_PROGRESS` súčasťou pravidiel: po 32 kolách bez toho, aby karta
odišla do odhadzovacej kôpky alebo sa zmenšil balík, hra končí patom.

## Boti

| Úroveň | Názov | Čo vie |
|---|---|---|
| 1 | Začiatočník | Najlacnejšia legálna karta, šetrí tromfy, nič si nepamätá. |
| 2 | Pokročilý | Fázy hry, tromfová ekonomika, rozhodnutie brať/brániť, neplytvá kartami na kolo, ktoré nemôže vyhrať. |
| 3 | Počtár | Rekonštruuje odhadzovaciu kôpku z event logu, pozná presne karty, ktoré si niekto zobral, počíta hypergeometrické pravdepodobnosti a **koncovku v hre dvoch rieši exaktne minimaxom**. |
| 4 | Majster | *(pripravuje sa)* model súperovej ruky + cielené blafovanie. |

Bot dostáva **len redigovaný `PlayerView`** — cudzie karty typovo nevidí a ESLint mu
zakazuje importovať čokoľvek, čo drží `GameState`. Sila sa meria na párovaných
rozdaniach (každé rozdanie sa hrá dvakrát s prehodenými miestami) s Wilsonovým
intervalom spoľahlivosti:

| Súboj | Skóre silnejšieho | 95 % interval | Hier |
|---|---|---|---|
| L2 vs L1 | 58,5 % | 55,3 – 61,7 | 1000 |
| L3 vs L2 | 59,4 % | 56,3 – 62,5 | 1000 |

`pnpm bench` vypíše celú maticu a **skončí nenulovo, ak rebrík nie je monotónny** —
zlepšenie, ktoré neprekoná dolnú hranicu intervalu, nie je zlepšenie.

Kľúčové pri L3: pri hre dvoch s prázdnym balíkom **nie je čo hádať** — každá karta
je buď naša, odhodená, na stole, alebo v ruke súpera. Pozícia je konečná hra
s úplnou informáciou, takže sa dá jednoducho vyriešiť.

## Produkcia

```bash
pnpm build
docker build -t durak .
docker run -p 3000:3000 durak
```

## Štruktúra

| Priečinok | Obsah | Pravidlá |
|---|---|---|
| `src/shared` | protokol (zod), `RuleConfig`, chybové kódy | izomorfné, bez závislosti na engine internals |
| `src/engine` | pravidlá hry | **čisté**: bez I/O, bez `Date`, bez `Math.random`, bez DOM |
| `src/bots` | politiky botov | vidia len redigovaný `PlayerView`, nikdy `GameState` |
| `src/server` | izby, sessions, WebSocket, timery | jediná stavová vrstva |
| `src/client` | React UI | so serverom komunikuje len protokolom |

Hranice vynucuje ESLint (`eslint.config.js`), nie dohoda — engine musí zostať čistý,
lebo ten istý kód beží ako autorita na serveri, ako predikcia v prehliadači aj vnútri
hľadania botov.

Licencie kartovej grafiky: [`ASSETS.md`](./ASSETS.md).
