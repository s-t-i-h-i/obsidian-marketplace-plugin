# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Czym to jest

Plugin do Obsidiana pozwalający **publikować folder z vaulta jako paczkę** (notatki, kurs, szablon) do własnego marketplace i **pobierać paczki z powrotem** do vaulta.

To połowa systemu. Druga połowa to osobne repo z backendem:

| | ścieżka |
|---|---|
| plugin (to repo) | `/Users/adrian/Documents/plugin-dev/.obsidian/plugins/obsidian-marketplace-plugin` |
| backend | `/Users/adrian/Documents/projects/obsidian-marketplace/obsidian-marketplace-backend` |

Backend to Cloudflare Worker: D1 (metadane) + R2 (archiwa ZIP). Kontrakt API nie jest wersjonowany, więc **plugin i worker wdraża się razem** — zmiana endpointu po jednej stronie psuje drugą.

## Pętla deweloperska

To repo leży **wewnątrz vaulta deweloperskiego** (`/Users/adrian/Documents/plugin-dev/`, katalog `.obsidian/plugins/`). esbuild zapisuje `main.js` obok `manifest.json`, czyli dokładnie tam, skąd Obsidian go czyta. Nie ma kroku kopiowania.

```
npm run dev        # watch, w tle na czas całej sesji
<edycja src/*.ts>
Cmd+R w Obsidianie # przeładowanie
```

Backend odpalany osobno, w drugim terminalu, słucha na `http://127.0.0.1:8787` — ten adres jest już wpisany w `data.json` jako `apiBaseUrl`.

## Komendy

Plugin:

```bash
npm run dev      # esbuild w trybie watch -> main.js
npm run build    # tsc -noEmit + esbuild production (minify)
npm run lint     # eslint z eslint-plugin-obsidianmd
```

Backend (z jego katalogu):

```bash
npm run dev                                                  # wrangler dev na :8787
npx wrangler d1 migrations apply obsidian-marketplace --local   # migracje lokalnie
npx wrangler d1 migrations apply obsidian-marketplace --remote  # migracje na produkcji
npm run deploy                                               # wrangler deploy
npx wrangler types                                           # po zmianie bindingów w wrangler.jsonc
```

**`npm test` w backendzie obecnie nie przechodzi.** `test/index.spec.ts` to nietknięty test z szablonu, który oczekuje `"Hello World!"` na `/`, a worker zwraca tam `404 Not found`. Do przepisania albo usunięcia — nie traktuj tej porażki jako regresji.

## Architektura

Dwa przepływy, każdy w osobnym zestawie modułów. Wspólny jest tylko format paczki (ZIP ze ścieżkami względnymi) i `settings.ts`.

```
PUBLIKOWANIE                              POBIERANIE
menu kontekstowe folderu                  komenda "Open marketplace"
  publishModal.ts   formularz               marketplaceModal.ts   siatka kafelków
  files.ts          zbiórka + linki         packagesApi.ts        GET /packages
  publishApi.ts     ZIP + multipart         packagesApi.ts        GET /download/:id
       |                                    installs.ts           walidacja + zapis
       v                                         ^
   POST /publish  ------>  Worker  ------>  GET /download/:id
                          D1 + R2
```

| Moduł | Odpowiedzialność |
|---|---|
| [src/main.ts](src/main.ts) | Wyłącznie cykl życia: komenda `open-marketplace`, pozycja **Publikuj** w menu kontekstowym folderu, rejestracja zakładki ustawień. Trzymaj ten plik mały. |
| [src/settings.ts](src/settings.ts) | `MarketplaceSettings` = `apiBaseUrl`, `defaultAuthor`, `downloadFolder`. Wartości puste są dozwolone — walidacja dzieje się w miejscu użycia, nie w `onChange`. |
| [src/files.ts](src/files.ts) | `collectFiles()` schodzi rekurencyjnie po folderze, filtruje po `ALLOWED_EXTENSIONS`, pomija katalogi zaczynające się od kropki. `findBrokenLinks()` czyta `app.metadataCache.resolvedLinks` i wykrywa linki wychodzące poza publikowany zestaw. |
| [src/publishApi.ts](src/publishApi.ts) | Pakuje pliki JSZipem i ręcznie buduje ciało `multipart/form-data`. |
| [src/packagesApi.ts](src/packagesApi.ts) | `fetchPackages()` (JSON) i `downloadPackageArchive()` (binarnie). Surowe wiersze z D1 przechodzą przez `toPackage()`, który wymusza typy — pola z bazy bywają `null`. |
| [src/installs.ts](src/installs.ts) | Rozpakowanie do vaulta. Najbardziej wrażliwy moduł, opis niżej. |
| [docs/publikowanie.md](docs/publikowanie.md) | Długi polski przewodnik po przepływie publikowania, od kliknięcia do żądania HTTP. |

### `installs.ts` — dwie fazy, nie jedna pętla

`installPackage()` **najpierw waliduje całe archiwum** (`planFiles()`), dopiero potem cokolwiek zapisuje (`writeFiles()`). Walidacja to same operacje na stringach, a daje gwarancję „albo cała paczka, albo nic". Gdy zapis mimo to padnie w połowie, `rollback()` wrzuca niedokończony folder do kosza przez `fileManager.trashFile()` — nigdy trwałe kasowanie.

Archiwum ze ścieżką uciekającą poza folder docelowy jest **odrzucane w całości**, nie „po cichu pomijane". To atak, a nie literówka autora.

## Kontrakt API

| Metoda | Ścieżka | Ciało / odpowiedź |
|---|---|---|
| `GET` | `/packages` | JSON: `[{id, title, description, author, tags, filename, created_at}]`, `tags` jako `"a,b,c"` |
| `POST` | `/publish` | `multipart/form-data`: `title`, `description`, `author`, `tags`, `file` (ZIP). Limit 50 MB, tylko `.zip`. Zwraca `201 {id, filename}` |
| `GET` | `/download/:id` | ciało ZIP-a, `Content-Type: application/zip` |

Błędy zawsze jako `{"error": "..."}` — po stronie pluginu rozpakowuje to `extractError()` w `packagesApi.ts`.

Backend: tabela D1 `packages` (binding `DB`, baza `obsidian-marketplace`), bucket R2 `obsidian-marketaplce-bucket` (binding `BUCKET`). Literówka w nazwie bucketa jest w prawdziwym zasobie Cloudflare — **nie poprawiaj jej**.

## Miny

Rzeczy, które kosztowały czas i nie widać ich z samego kodu.

1. **`package` to słowo zarezerwowane w strict mode**, a moduły ES zawsze są strict. `const package = ...` to `SyntaxError`. Typy i funkcje mogą mieć `Package`, **zmienne muszą być `pkg`**. Liczba mnoga `packages` jest bezpieczna.

2. **`requestUrl()` nie przyjmuje `FormData`.** Dlatego `publishApi.ts` skleja ciało multipart bajt po bajcie. Nie zastępuj tego `fetch`em — `requestUrl` omija CORS i po to właśnie istnieje w API Obsidiana.

3. **Nie czytaj `response.json` przy odpowiedzi binarnej.** To getter robiący `JSON.parse` — na ZIP-ie zaczynającym się od `PK` rzuci `SyntaxError`. W gałęzi błędu `response.text` jest bezpieczny, bo tam serwer zwraca JSON.

4. **JSZip normalizuje ścieżki przy `loadAsync()`** (`utils.resolve()`, wołane w `lib/load.js`): zwija `..` i `.`, czyści `//`. Ale **celowo zostawia pusty pierwszy segment**, więc `/abs/path.md` wychodzi nadal absolutne, i **nie rusza backslashy**. Dlatego `safeRelativePath()` w `installs.ts` nie jest nadmiarowe — łata dokładnie te dwie dziury.

5. **`vault.createFolder()` i `vault.createBinary()` rzucają, gdy cel istnieje.** Foldery trzeba tworzyć od korzenia w dół, a już utworzone trzymać w `Set`. ZIP nie gwarantuje wpisów katalogowych ani ich kolejności.

6. **`eslint-plugin-obsidianmd` waliduje `minAppVersion` względem użytego API.** Sięgnięcie po nowszą metodę to **błąd** lintera, dopóki nie podbijesz `manifest.json` i `versions.json`. Aktualnie `1.6.6`, wymuszone przez `Vault.createFolder` (1.4.0) i `FileManager.trashFile` (1.6.6).

7. **Backend przyjmuje 0-bajtowe ZIP-y** — `publishPackage()` sprawdza górny limit, ale nie dolny. W bazie jest już taka paczka („Test"), serwowana ze statusem 200. Łapie to dopiero kontrola `byteLength` w `downloadPackageArchive()`. Dług do spłacenia po stronie workera.

8. **Migracja D1 idzie przed `wrangler deploy`**, nie po. Nowy kod pyta o tabelę, której jeszcze nie ma.

## Testowanie bez Obsidiana

Logikę `installs.ts` i `packagesApi.ts` można sprawdzić headlessowo: podmienia się moduł `obsidian` na atrapę, a `app.vault` na mapę `ścieżka → zawartość`. Atrapa musi eksportować `normalizePath` oraz klasy używane jako wartości (`Modal`, `Setting`, `PluginSettingTab`, `ButtonComponent`, `Notice`, `Plugin`). `requestUrl` da się odwzorować na node'owym `fetch`, co pozwala testować cały łańcuch przeciwko działającemu `wrangler dev`.

```bash
npx esbuild harness.ts --bundle --platform=node --format=esm --outfile=harness.mjs \
  --alias:obsidian=./obsidian-stub.js --alias:jszip="$PWD/node_modules/jszip" && node harness.mjs
```

Złośliwe archiwum do testów zip-slip trzeba zbudować **poza JSZipem** — JSZip normalizuje ścieżki również przy zapisie, więc test zbudowany jego API niczego nie dowodzi:

```bash
python3 -c "import zipfile; z=zipfile.ZipFile('/tmp/evil.zip','w'); z.writestr('../../../hacked.md','x'); z.writestr('..\\\\..\\\\win.md','x'); z.writestr('/abs/root.md','x'); z.close()"
```

## Konwencje

- **Komentarze i teksty UI po polsku.** Wyjątek: nazwy komend (`Open marketplace`). Lintowa reguła `obsidianmd/ui/sentence-case` wymaga wielkiej litery na początku opisów w ustawieniach.
- Komentarz tłumaczy **dlaczego**, nie **co**. Istniejący kod trzyma ten poziom — dopasuj się do niego.
- Taby, pojedyncze cudzysłowy, przecinki końcowe.
- `main.ts` zostaje wyłącznie cyklem życia; logika idzie do osobnych modułów.
- `AGENTS.md` w tym repo to ogólne zasady pluginów Obsidiana (z szablonu). Ten plik jest warstwą specyficzną dla projektu — przy sprzeczności wygrywa ten plik.
- `README.md` jest nadal z szablonu `obsidian-sample-plugin` i **nie opisuje tego projektu**. Nie cytuj go jako źródła prawdy.
