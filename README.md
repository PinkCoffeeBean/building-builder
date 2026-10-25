# Gevelbouwer

Een 3D-browserspel waarin je op een grid gebouwen ontwerpt, gericht op het **exterieur**:
stapel bouwvolumes, zet ramen, deuren, balkons, luifels en trappen op de gevels, kies kleuren en
materialen en maak er een "productfoto" van, in de stijl van moderne clay-render-architectuurillustraties.

Gemaakt met Vite, TypeScript en Three.js. Alles is in code gemodelleerd; er zijn geen externe 3D-assets.

## Starten

```bash
npm install
npm run dev        # ontwikkelserver op http://localhost:5173
npm run build      # typecheck + productiebuild in dist/
```

## Bediening

| Actie | Muis / toetsenbord | Touch |
|---|---|---|
| Plaatsen | linksklik | tik |
| Verwijderen | rechtsklik, of Gum (G) + klik | Gum + tik |
| Schuiven | slepen | één vinger slepen |
| Zoomen | scrollwiel | knijpen |
| Element draaien of uitlijnen (links/midden/rechts) | R | knoppen in het paneel |
| Camera 90° draaien | Q / E | ⟲ ⟳ in de bovenbalk |
| Iso ↔ vooraanzicht | V | knop in de bovenbalk |
| Alles in beeld | F | ⤢ |
| Categorie kiezen | 1 – 7 | |
| Ongedaan maken / opnieuw | Ctrl+Z / Ctrl+Y | ↶ ↷ |
| Opslaan in galerij | Ctrl+S | 💾 |
| Fotomodus | P | 📷 |

Een element onder de muis wordt als ghost getoond. Als plaatsen niet kan, kleurt de ghost rood en
staat de reden linksonder.

## Functies

- **Volumes**: blokken per cel per verdieping (kavel 8×8, maximaal 6 lagen). Aangrenzende blokken met
  dezelfde kleur en bekleding versmelten tot één afgerond volume zonder naden; verschillende kleuren
  krijgen een subtiele groef.
- **Gevel**: ramen (kruisroede, staand, spleet, panorama, lintraam over 2 of 3 cellen, trappenhuisraam
  over 2 of 3 lagen, dakraampje, boog, vitrage), deuren (rechthoekig, boog, dubbel, garage, houten latjes,
  glazen pui), luifels (vlak, met lamp, portiek, gestreepte markies). Openingen worden echt uit de gevel
  gesneden, met dagkanten (verdiept kozijn), vensterbanken en roedes.
- **Balkons**: uitkragend met spijlenhek, breed (2 cellen), met borstwering, met glazen balustrade,
  inpandige loggia en Frans balkon.
- **Dak**: plat met dakrand, brede opstand, plat met overstek (stuc of hout), lessenaarsdak met golfplaat
  en balkkoppen, dakterras met hek, plat zonder rand, schoorstenen.
- **Omgeving**: trap naar de voordeur (losse treden), bordestrap, zijtrap, gevelborden met eigen tekst
  (staand en liggend), bolboom, cypres, palm, struik, plantvak, plantenbak, bloempot, lantaarnpaal en bankje.
- **Verf**: heel volume, één blok, één gevelvlak (met bekleding: stuc, hout, natuursteen, beton,
  baksteen, tegels), elementen (hoofd- of accentkleur), dak, sokkel en een pipet.
- **Ontwerp**: achtergrond, sokkelkleur, plint en gevelbanden aan/uit met eigen kleur, AO aan/uit.
- **Opslaan & delen**: galerij in localStorage met thumbnails, JSON-export en -import, en automatisch
  bewaren van je laatste werk.
- **Fotomodus**: de interface verdwijnt; je kiest achtergrond, vrije camerahoek, zoom, beeldverhouding
  en resolutie (tot 4096 px) en exporteert een PNG.
- **Opdrachten**: zeven opdrachten (bakkerij, hotel, Grieks vakantiehuis, Bauhaus-villa, tiny house,
  stadswoning met garage, groene oase) met live checklist en 1 tot 3 sterren. Je beste score wordt bewaard.
- **Voorbeelden** in de galerij: een wit-blauw huisje met boogdeur en boom, een petrol/oranje huis met
  garage en balkon, en een Bauhaus-gebouw in wit, geel en roze met een hoge toren en een lange smalle raamstrook.

## Mappenstructuur

```
src/
  main.ts                    start de app
  catalog/catalog.ts         ★ alle elementen, materialen, paletten (data-gedreven)
  core/
    types.ts                 datamodel van een ontwerp
    grid.ts                  rasterconstanten, coördinaten, CellMap
    rules.ts                 plaatsingsregels en opschonen
    store.ts                 huidig ontwerp + undo/redo
  render/
    stage.ts                 renderer, licht, schaduw, GTAO, iso/vooraanzicht-camera, PNG-snapshot
    blockGeometry.ts         afgeronde voxelvlakken met selectieve afronding en uitgespaarde gaten
    buildDesign.ts           ontwerp → Three.js-groep (volumes, plint, banden, elementen, sokkel)
    materials.ts             matte clay-materialen + procedurele texturen (canvas)
    shapes.ts                hulpgeometrie
    builders/facade.ts       ramen, deuren, balkons, luifels, borden, trappen
    builders/roof.ts         dakranden, overstek, lessenaarsdak, dakterras
    builders/env.ts          bomen, planten, lantaarn, bank, schoorsteen
  interaction/controller.ts  muis/touch, raycasting, ghost-preview, plaatsen/wissen/verven
  missions/missions.ts       ★ opdrachten en hun controles
  samples/samples.ts         de drie voorbeeldontwerpen
  storage/storage.ts         galerij (localStorage), JSON, downloads
  ui/                        interface (app.ts), stijlen, pictogram-renderer, DOM-hulpjes
```

## Zelf elementen toevoegen

Alles staat als data in `src/catalog/catalog.ts`. Maten zijn in cel-eenheden (1 cel ≈ 3 m);
lokale x loopt van links naar rechts over de gevel en y = 0 is het vloerpeil van de verdieping.

Een nieuw raam:

```ts
{
  kind: 'window', id: 'win-square-big', name: 'Groot vierkant raam', category: 'windows',
  span: [1, 1],            // cellen breed × hoog
  width: 0.5, height: 0.5, // opening
  sill: 0.25,              // borstweringshoogte
  cols: 3, rows: 3,        // roedeverdeling
  frame: 0.025, depth: 0.07, sillPlate: true,
  color: '#2a2e35', accent: '#d9d6cf', colorLabels: ['Kozijn', 'Vensterbank'],
},
```

Een nieuw kleurpalet voeg je toe aan `PALETTES`, een opdracht aan `MISSIONS` in
`src/missions/missions.ts`. Pictogrammen in de gereedschapsbalk worden automatisch gerenderd.

## Bestandsformaat

Een ontwerp is gewone JSON (`Design` in `src/core/types.ts`) met `cells` (x, y, z, kleur, bekleding,
optioneel per gevelvlak een afwijkende stijl en een dakstijl), `facade` (gevelelementen met anker-cel,
richting, uitlijning en kleuren), `roofItems`, `env` en `settings`.
