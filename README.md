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
```

## Boti

| Úroveň | Názov | Čo vie |
|---|---|---|
| 1 | Začiatočník | Najlacnejšia legálna karta, šetrí tromfy, nič si nepamätá. |
| 2 | Pokročilý | Fázy hry, tromfová ekonomika, rozhodnutie brať/brániť, neplytvá kartami na kolo, ktoré nemôže vyhrať. |
| 3 | Počtár | *(pripravuje sa)* počíta odhodené karty a hypergeometrické pravdepodobnosti. |
| 4 | Majster | *(pripravuje sa)* model súperovej ruky + cielené blafovanie. |

Bot dostáva **len redigovaný `PlayerView`** — cudzie karty typovo nevidí a ESLint mu
zakazuje importovať čokoľvek, čo drží `GameState`. Sila sa meria na párovaných
rozdaniach (každé rozdanie sa hrá dvakrát s prehodenými miestami) s Wilsonovým
intervalom spoľahlivosti; L2 poráža L1 na **60,2 % [58,5 – 61,8]** zo 4000 hier.

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
