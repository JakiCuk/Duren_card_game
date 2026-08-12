# Durak

Webová kartová hra Durak — proti botom (4 úrovne zložitosti) aj proti živým hráčom online.

Jedna Node aplikácia: Fastify servíruje statický React build aj WebSocket. Bez databázy,
bez účtov — izby sa vytvárajú anonymne a zdieľajú kódom.

## Vzhľad a nastavenia

Rozhranie vychádza z návrhu **Durak Stôl** z Claude Design. Stôl je oválny a vždy sa
točí tak, aby si sedel dole: tvoja ruka je rozložená do vejára pozdĺž spodnej hrany
a pod pointerom sa karty nadvihujú, súperi sedia po obvode ako menovky s avatarom,
rolou a počtom kariet, balík leží naľavo od kariet v hre a nad nimi sú údaje o hre.
Pod stolom sú tlačidlá a riadok „kto je na ťahu". Vpravo pláva voliteľný prepis.

### Karty

Dva balíčky, prepínajú sa v nastaveniach:

- **Klasické** — skutočné SVG z balíčka Tek Eye (public domain).
- **Minimal** — kreslené, generuje ich `tools/make-minimal-deck.ts`: index v rohu a jeden
  veľký znak farby. Hodnoty sú rovnaké ako v klasickom balíčku (J, Q, K, A), aby oba
  balíčky pomenovali tú istú kartu rovnako.

Karty sa animujú: prilietavajú zo stoličky hráča, ktorý ich zahral, a po kole odlietavajú
buď k obrancovi (keď bral), alebo na odhadzovaciu kôpku. Pri `prefers-reduced-motion` sa
animácie nespúšťajú.

### Tri štýly

V nastaveniach sa prepína **grafický štýl** a **denný/nočný režim**. Celý vzhľad drží
na custom properties na koreňovom prvku, takže štýl je blok premenných a nie zásah do
komponentov:

- **Organic** — teplé zemité farby, mäkké tvary, písmo Caprasimo + Figtree.
- **Modern** — chladná modrá, ostrejšie rohy, Space Grotesk.
- **Klasik** — zelený filc a bordová, Playfair Display + serif.

Písma sa ťahajú z Google Fonts a je to **jediná požiadavka mimo vlastného originu**;
každý stack končí systémovým fallbackom, takže stroj bez siete dostane rozumnú stránku.

### Nastavenia

Nastavenia, pravidlá a chat sú **vyskakovacie panely v hlavičke**, nie bloky nad stolom —
stôl tak dostane celé okno a knoby sa nad ním len na chvíľu otvoria. Tlačidlo
**Priebeh** prepína prepis.

V paneli **Nastavenia a nová hra** je aj:

- **Balíček kariet** — klasické alebo minimal.
- **Zoradiť karty** — podľa farby (skupiny farieb, tromfy nakoniec) alebo podľa sily
  (jeden rad od najslabšej po najsilnejšiu).
- **Nápoveda ťahu** — stmaví karty, ktoré teraz nemôžeš zahrať. Vypnuté vyzerá ruka
  rovnako a musíš si to ustrážiť sám.

- **Pauza botov** — ako dlho bot počká, kým položí kartu. Nula = okamžite.
- **Počkať na mňa, keď môžem prihodiť** — boti sa zastavia a hra sa spýta, či
  prihodíš. Pýta sa **až na konci kola**: keď je všetko na stole zbité (alebo obranca
  berie) a všetci ostatní útočníci už dohodili. Uprostred kola, kým obranca ešte
  odpovedá, sa nepýta na nič.
- **Zobraziť údaje o hre** — tromf, kolo, zvyšok balíka a odhodené, nad tvojimi kartami.
- **Zobraziť prepis hry** — bočný stĺpec s tým, kto čo položil.

Nastavenia sa pamätajú v prehliadači. Pauza botov platí pre hru na tomto zariadení;
v online izbe tempo botov určuje server (`BOT_DELAY_MS`).

## Ako sa k hre pripojiť

```bash
pnpm install
pnpm dev
```

Otvor **http://localhost:5173**. Vite servíruje UI, Fastify na :3000 drží WebSocket
a herný stav; Vite mu proxuje `/ws` a `/api`, takže stačí jedna adresa.

Dev server počúva aj na sieti — po štarte vypíše `Network: http://192.168.x.x:5173/`.
Tú adresu pošli komukoľvek na rovnakej Wi-Fi a môžete hrať spolu: v hre prepni na
**Online izba**, klikni *Vytvoriť izbu* a pošli 5-znakový kód.

Na hru s niekým mimo tvojej siete treba server niekam nasadiť (viď Produkcia) alebo
port dočasne pretunelovať, napr. `cloudflared tunnel --url http://localhost:5173`.

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
| 4 | Majster | Model súperovej ruky (Sinkhorn nad maticou „kto čo drží"), determinizované PIMC hľadanie a blafovanie s ε-obmedzením. |

Bot dostáva **len redigovaný `PlayerView`** — cudzie karty typovo nevidí a ESLint mu
zakazuje importovať čokoľvek, čo drží `GameState`. Sila sa meria na párovaných
rozdaniach (každé rozdanie sa hrá dvakrát s prehodenými miestami) s Wilsonovým
intervalom spoľahlivosti:

| Súboj | Skóre silnejšieho | 95 % interval | Hier |
|---|---|---|---|
| L2 vs L1 | 58,5 % | 55,3 – 61,7 | 1000 |
| L3 vs L2 | 59,4 % | 56,3 – 62,5 | 1000 |
| L4 vs L3 | 61,5 % | 57,1 – 65,8 | 500 |

`pnpm bench` vypíše celú maticu a **skončí nenulovo, ak rebrík nie je monotónny** —
zlepšenie, ktoré neprekoná dolnú hranicu intervalu, nie je zlepšenie.

Kľúčové pri L3: pri hre dvoch s prázdnym balíkom **nie je čo hádať** — každá karta
je buď naša, odhodená, na stole, alebo v ruke súpera. Pozícia je konečná hra
s úplnou informáciou, takže sa dá jednoducho vyriešiť.

Pri L4 rozhoduje **počet vzoriek**: 8 determinizácií dá 34 %, 18 dá 51 %, 64 dá 66 %.
Pod tou hranicou hľadanie neváži ťahy, ale meria vlastný šum. Horizont 4 je *horší*
než 2 — to je známa patológia PIMC (strategy fusion) presne tam, kde ju literatúra
predpovedá.

**Cena L4:** medián 32 ms na rozhodnutie, p90 81 ms, p99 261 ms (merané samostatne).
Pri nastavenej pauze bota (~0,9 s) to hráč nepocíti. Beží synchrónne — worker pool by
za ohraničených ~300 ms pridal serializáciu pohľadu, správu workerov a nový režim
zlyhania. Ak by na jednom serveri bežali desiatky izieb naraz s L4, vtedy je čas ich
pridať; dovtedy nie.

**Blafovanie je poctivo zmerané:** proti botovi, ktorý o nás nič neodvodzuje,
neprináša nič (66,5 % s ním, 65,8 % bez neho — v šume). Váha 0,5 už stojí šesť bodov.
Preto je nastavené na 0,2 a s ε-obmedzením: blafuje sa len vtedy, keď je to takmer
zadarmo. Proti človeku, ktorý závery robí, by to malo znamenať viac — to sa ale
botom zmerať nedá.

## Produkcia

```bash
pnpm build && pnpm start          # všetko na jednom porte: http://localhost:3000
# alebo
docker build -t durak . && docker run -p 3000:3000 durak
```

V produkcii Fastify servíruje aj statický build aj WebSocket, takže žiadne proxy
netreba a hra beží na jedinej adrese. Užitočné premenné: `PORT`, `MAX_ROOMS`,
`ROOM_IDLE_MS`, `GRACE_MS`, `TURN_TIMEOUT_MS`, `BOT_DELAY_MS`.

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
