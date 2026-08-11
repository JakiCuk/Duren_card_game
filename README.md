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
pnpm sim -- --games 10000    # fuzzer herného jadra
pnpm bench                   # matica sily botov
```

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
