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

Backend odpalany osobno, w drugim terminalu, słucha na `http://127.0.0.1:8787` — i dokładnie ten adres `npm run dev` wkompilowuje we wtyczkę. Nie ma go w ustawieniach: wybiera go build (`define` w `esbuild.config.mjs`), a `npm run build` podstawia produkcyjnego workera. Gdy port 8787 jest zajęty albo stawiasz własną instancję:

```bash
MARKETPLACE_API_URL=http://localhost:8788 npm run dev
```

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
  publishModal.ts   formularz + przegląd    marketplaceModal.ts   siatka kafelków
  files.ts          zbiórka + linki         packagesApi.ts        GET /packages
  scan.ts           aktywna treść           packagesApi.ts        GET /download/:id
  publishApi.ts     ZIP + multipart         scan.ts + installs.ts walidacja + zapis
       (oba przechodzą przez api/api.ts — Authorization + adres + obsługa błędów)
       |                                         ^
       v                                         |
   POST /publish  ------>  Worker  ------>  GET /download/:id
                          D1 + R2
```

| Moduł | Odpowiedzialność |
|---|---|
| [src/main.ts](src/main.ts) | Wyłącznie cykl życia: komenda `open-marketplace`, pozycja **Publikuj** w menu kontekstowym folderu, rejestracja zakładki ustawień. Trzymaj ten plik mały. |
| [src/settings.ts](src/settings.ts) | `MarketplaceSettings` = `token`, `username`, `userId`, `downloadFolder` — adresu API tu **nie ma**, jest stałą z builda. Wartości puste są dozwolone — walidacja dzieje się w miejscu użycia, nie w `onChange`. Zakładka sama się nie przerysowuje: po rejestracji i wylogowaniu trzeba zawołać `this.display()`. |
| [src/api/api.ts](src/api/api.ts) | Jedyna droga do serwera. Skleja URL, wstrzykuje `Authorization`, rozpakowuje `{"error"}` i rozróżnia `UnauthorizedError` od `ApiError`. Zwraca surową odpowiedź — treść czyta wywołujący. |
| [src/api/accountApi.ts](src/api/accountApi.ts) | `registerAccount()`, `fetchMe()`, `createToken()`, `revokeToken()`, `closeAccount()`. |
| [src/ui.ts](src/ui.ts) | `armButton()` — dwustopniowe potwierdzenie dla akcji nieodwracalnych. Obsidian nie ma okna potwierdzenia. |
| [src/constants.ts](src/constants.ts) | `API_BASE_URL` (stała wstawiana przez esbuild — patrz mina 23), `ALLOWED_EXTENSIONS` (jedna lista dla publikacji i instalacji) oraz limity archiwum: rozmiar, liczba plików, głębokość, stopień kompresji. |
| [src/scan.ts](src/scan.ts) | Wykrywanie **aktywnej treści**: bloki wykonywane przez wtyczki (`dataviewjs`, Templater, Execute Code), `<script>`, `<iframe>`, atrybuty zdarzeń, `javascript:`, węzły `link` w canvasie, skrypty w SVG, treść ładowana z sieci. Heurystyka — **ostrzega, nie blokuje**. |
| [src/review.ts](src/review.ts) | Wspólny widok znalezisk dla obu przepływów. Notice się nie nadaje: znika i nie da się go przewinąć. |
| [src/files.ts](src/files.ts) | `collectFiles()` schodzi rekurencyjnie po folderze, filtruje po `ALLOWED_EXTENSIONS`, pomija katalogi zaczynające się od kropki. `findBrokenLinks()` czyta **oba** indeksy — `resolvedLinks` (cel poza paczką → `problem: 'outside'`) i `unresolvedLinks` (cel nie istnieje → `'unresolved'`). |
| [src/api/publishApi.ts](src/api/publishApi.ts) | Pakuje pliki JSZipem i ręcznie buduje ciało `multipart/form-data`. Autor **nie** jest polem formularza — bierze się z tokenu po stronie serwera. |
| [src/api/packagesApi.ts](src/api/packagesApi.ts) | `fetchPackages()` (lista), `fetchPackage()` (szczegóły ze strukturą), `downloadPackageArchive()` (binarnie) i `deletePackage()`. Surowe wiersze z D1 przechodzą przez `toPackage()`, który wymusza typy — pola z bazy bywają `null`. |
| [src/installs.ts](src/installs.ts) | Rozpakowanie do vaulta. Najbardziej wrażliwy moduł, opis niżej. |
| [docs/konta.md](docs/konta.md) | Przewodnik krok po kroku po kontach, tokenach, rotacji i zamykaniu konta. Opisuje też, co robi każdy przycisk w ustawieniach. |
| [docs/publikowanie.md](docs/publikowanie.md) | Długi polski przewodnik po przepływie publikowania, od kliknięcia do żądania HTTP. |

### `installs.ts` — dwie fazy, nie jedna pętla

`installPackage()` **najpierw waliduje całe archiwum** (`planFiles()`), dopiero potem cokolwiek zapisuje (`writeFiles()`). Walidacja to same operacje na stringach, a daje gwarancję „albo cała paczka, albo nic". Gdy zapis mimo to padnie w połowie, `rollback()` wrzuca niedokończony folder do kosza przez `fileManager.trashFile()` — nigdy trwałe kasowanie.

Archiwum ze ścieżką uciekającą poza folder docelowy jest **odrzucane w całości**, nie „po cichu pomijane". To atak, a nie literówka autora.

### Uwierzytelnianie

Personal access tokens, nie OAuth. Serwer losuje token (`omp_` + 64 hex, 32 bajty z CSPRNG),
oddaje go **raz** przy rejestracji i trzyma wyłącznie `SHA-256`. Autor paczki bierze się
z tokenu, nigdy z formularza — to zamyka podszywanie się, które było możliwe wcześniej.
Ban to flaga `is_banned` sprawdzana w `authenticate()`, więc obejmuje każdy endpoint z automatu.

**Wylogowanie ≠ unieważnienie.** Konto ma tylko jedno poświadczenie i zero odzyskiwania,
więc te dwie akcje są w UI rozdzielone: „Wyloguj z tego urządzenia" czyści wyłącznie
`data.json` (token dalej działa, można go wkleić z powrotem), a „Unieważnij" kasuje go
na serwerze. Rotacja idzie przez `POST /tokens`: wyrób nowy → unieważnij stary. Bez tego
unieważnienie skradzionego tokenu oznaczałoby utratę konta.

Kod: `src/auth.ts` + `src/http.ts` w repo backendu, [src/api/api.ts](src/api/api.ts) w tym repo.

## Kontrakt API

| Metoda | Ścieżka | Ciało / odpowiedź |
|---|---|---|
| `GET` | `/packages` | publiczne. JSON: `[{id, title, description, author, author_id, tags, filename, created_at}]`, `tags` jako `"a,b,c"` |
| `GET` | `/packages/:id` | publiczne. Jedna paczka **ze `structure`** (JSON-owa tablica ścieżek). Lista celowo tego pola nie niesie |
| `GET` | `/download/:id` | publiczne. Ciało ZIP-a, `Content-Type: application/zip` |
| `POST` | `/register` | publiczne, limit 3/60 s na IP. `{username}` (3-32 znaki, `[a-zA-Z0-9_-]`). Zwraca `201 {user_id, username, token}` — **token pokazywany jest raz** |
| `GET` | `/me` | 🔒 zwraca `{user_id, username, tokens}` — `tokens` to liczba tokenów konta |
| `POST` | `/tokens` | 🔒 wydaje **dodatkowy** token (`{label}`), max 10 na konto. Zwraca `201 {token}` |
| `DELETE` | `/tokens` | 🔒 unieważnia bieżący token |
| `DELETE` | `/account` | 🔒 kasuje konto, jego tokeny i **wszystkie jego paczki** (D1 + R2). Zwraca `{ok, deleted_packages}` |
| `POST` | `/publish` | 🔒 `multipart/form-data`: `title` (≤200), `description` (≤5000), `tags` (≤200), `file` (ZIP). Limit 50 MB i 10 publikacji/dobę. Autor bierze się z tokenu; pola `author` **i `structure`** są **ignorowane** — strukturę worker czyta z samego archiwum. Zwraca `201 {id, filename, author}`, `413` przy przekroczeniu rozmiaru |
| `DELETE` | `/packages/:id` | 🔒 tylko właściciel; cudza paczka → `403` |

🔒 = wymaga `Authorization: Bearer omp_<64 hex>`. Brak/zły token → `401`.

Błędy zawsze jako `{"error": "..."}` — po stronie pluginu rozpakowuje to `extractError()` w `api/api.ts`.
Cały `fetch()` workera stoi w `try/catch`, więc nawet nieprzewidziany wyjątek wraca jako JSON **z nagłówkami CORS**,
a nie jako gołe 500 ze stosem wywołań.

Archiwum jest sprawdzane w `src/zip.ts` (backend) z **katalogu centralnego**, czyli bez dekompresji:
sygnatura `PK`, brak zip64 i szyfrowania, ≤2000 wpisów, ≤200 MB po rozpakowaniu, stosunek ≤100:1,
ścieżki względne bez `..`, backslashy, znaków sterujących i przesterowania kierunku tekstu, bez duplikatów.
Ta sama lista kontrolna stoi po stronie wtyczki w `installs.ts` — serwer i klient mogą być wdrożone rozdzielnie.

Backend: tabela D1 `packages` (binding `DB`, baza `obsidian-marketplace`), tabela `publish_events` (dobowy limit publikacji), bucket R2 `obsidian-marketaplce-bucket` (binding `BUCKET`). Literówka w nazwie bucketa jest w prawdziwym zasobie Cloudflare — **nie poprawiaj jej**.

## Miny

Rzeczy, które kosztowały czas i nie widać ich z samego kodu.

1. **`package` to słowo zarezerwowane w strict mode**, a moduły ES zawsze są strict. `const package = ...` to `SyntaxError`. Typy i funkcje mogą mieć `Package`, **zmienne muszą być `pkg`**. Liczba mnoga `packages` jest bezpieczna.

2. **`requestUrl()` nie przyjmuje `FormData`.** Dlatego `publishApi.ts` skleja ciało multipart bajt po bajcie. Nie zastępuj tego `fetch`em — `requestUrl` omija CORS i po to właśnie istnieje w API Obsidiana.

3. **Nie czytaj `response.json` przy odpowiedzi binarnej.** To getter robiący `JSON.parse` — na ZIP-ie zaczynającym się od `PK` rzuci `SyntaxError`. W gałęzi błędu `response.text` jest bezpieczny, bo tam serwer zwraca JSON.

4. **JSZip normalizuje ścieżki przy `loadAsync()`** (`utils.resolve()`, wołane w `lib/load.js`): zwija `..` i `.`, czyści `//`. Ale **celowo zostawia pusty pierwszy segment**, więc `/abs/path.md` wychodzi nadal absolutne, i **nie rusza backslashy**. Dlatego `safeRelativePath()` w `installs.ts` nie jest nadmiarowe — łata dokładnie te dwie dziury.

5. **`vault.createFolder()` i `vault.createBinary()` rzucają, gdy cel istnieje.** Foldery trzeba tworzyć od korzenia w dół, a już utworzone trzymać w `Set`. ZIP nie gwarantuje wpisów katalogowych ani ich kolejności.

6. **`eslint-plugin-obsidianmd` waliduje `minAppVersion` względem użytego API.** Sięgnięcie po nowszą metodę to **błąd** lintera, dopóki nie podbijesz `manifest.json` i `versions.json`. Aktualnie `1.6.6`, wymuszone przez `Vault.createFolder` (1.4.0) i `FileManager.trashFile` (1.6.6).

7. **Zastane paczki bywają uszkodzone.** Worker przez długi czas przyjmował 0-bajtowe ZIP-y i pliki, które w ogóle nie były archiwami — w bazie leżą takie wpisy (m.in. „Test", „Pusty", „NieZip"), serwowane ze statusem 200. Nowe publikacje odrzuca `inspectZip()`, ale **stare rekordy zostały** i wywalą się dopiero przy pobieraniu. Przy sprzątaniu bazy to pierwsze do usunięcia.

8. **Migracja D1 idzie przed `wrangler deploy`**, nie po. Nowy kod pyta o tabelę, której jeszcze nie ma.

9. **Granica multipart musi być losowa.** Wartości pól wstawiamy do ciała surowo (escapowany jest tylko `filename`), więc przy granicy z `Date.now()` wystarczał wielolinijkowy opis, żeby domknąć część i dokleić własne pola. `randomBoundary()` w `publishApi.ts` łata to u źródła — nie zastępuj go niczym przewidywalnym i nie „napraw" tego okrajaniem opisu.

10. **Token idzie nagłówkiem, nigdy polem formularza** — z tego samego powodu co wyżej.

11. **`created_at` to TEKST ISO-8601, nie liczba.** Porównanie okna czasowego z `Date.now()` nie rzuca błędu, tylko cicho nigdy nie trafia i limit przestaje istnieć. Zawsze `new Date(...).toISOString()`.

12. **Nie deklaruj `interface Env` w `src/index.ts`.** Lokalna deklaracja przesłania typ generowany z bindingów przez `wrangler types` i każdy nowy binding trzeba by dopisywać ręcznie. `Env` jest globalny.

13. **Usunięcie użytkownika blokuje FK**, dopóki ma paczki (`packages.author_id` bez `ON DELETE`). To celowe — banuje się flagą, nie kasowaniem. Dlatego `handleCloseAccount()` kasuje paczki **przed** kontem, w jednym `batch()`; kaskada na `tokens` odpali się dopiero, gdy sam `DELETE` z `users` przejdzie.

14. **Callback `Setting.addText()` (i `addButton`, `addDropdown`…) wykonuje się SYNCHRONICZNIE w trakcie łańcucha.** Odwołanie w jego wnętrzu do `const setting = new Setting(...)` trafia w martwą strefę czasową i rzuca `Cannot access 'setting' before initialization` — po minifikacji `'e'`, co nic nie mówi. Gorzej: wyjątek leci w środku `display()`, więc **cała reszta zakładki przestaje się renderować**. Komponent zapamiętuj w `let` zadeklarowanym wcześniej, a kolejne przyciski dokładaj po domknięciu łańcucha. `tsc` tego nie łapie — łapie to `uitest` z atrapą DOM-u (patrz niżej).

15. **`structure` nie pochodzi już od klienta w ogóle.** Wcześniej worker przepisywał przysłaną tablicę (parsował, filtrował, obcinał) — ale to nadal był spis **zadeklarowany** przez wysyłającego, więc podgląd potrafił pokazywać trzy niewinne notatki, a archiwum zawierać pięćset innych plików. Teraz `publishPackage()` czyta nazwy z katalogu centralnego ZIP-a i pole z formularza ignoruje, dokładnie tak jak `author`.

16. **`decodeURIComponent` rzuca `URIError` na niedokończonej sekwencji.** `GET /packages/%` wywracało cały `fetch()` workera: workerd oddawał gołe 500, ze stosem wywołań i **bez nagłówków CORS**, więc wtyczka widziała tylko „błąd sieci". To była ścieżka publiczna, bez tokenu. Dlatego `segment()` łapie wyjątek, a `fetch()` ma zewnętrzny `try/catch`.

17. **Limit liczony ze stanu, który użytkownik może skasować, nie jest limitem.** Dobowy limit publikacji brał się z `SELECT COUNT(*) FROM packages`, więc pętla „opublikuj 10 → usuń 10" zerowała licznik. Zmierzone: 30 publikacji przy limicie 10, i tak w nieskończoność. Liczy się teraz z `publish_events`, którego `DELETE /packages/:id` celowo **nie** rusza.

18. **JSZip normalizuje ścieżki przy `loadAsync()`, więc traversal nie dojdzie do walidatora.** `../../pwned.md` staje się `pwned.md` — plik nie ucieka, ale i nie da się go odróżnić od zwykłej notatki, więc zamierzone „odrzuć całe archiwum" nigdy się nie odpala. Prawdziwe odrzucenie robi backend, który czyta **surowe** nazwy z katalogu centralnego. Nie zakładaj, że kontrola po stronie wtyczki zobaczy oryginalną ścieżkę.

19. **`test()` na wyrażeniu regularnym z flagą `/g` jest stanowy.** Pamięta `lastIndex` między wywołaniami, więc co drugie sprawdzenie tej samej nazwy wychodzi czyste. W `installs.ts` te same klasy znaków istnieją w dwóch wariantach: bez `/g` do `test()`, z `/g` do `replace()`. Nie „upraszczaj" tego z powrotem do jednej stałej.

20. **Rozmiar po rozpakowaniu czyta się z metadanych, nie po `async()`.** `entry._data.uncompressedSize` jest dostępny od razu po `loadAsync()`; po zdekompresowaniu dane siedzą już w pamięci i limit nic nie daje. 204 kB archiwum deklaruje 200 MB zawartości. `_data` to pole wewnętrzne JSZipa — czytane defensywnie, bo może zniknąć przy aktualizacji biblioteki.

21. **Sam sufit bajtów nie łapie bomby zip.** Archiwum mieszczące się tuż pod limitem dalej jest bombą, jeśli waży 200 kB. Potrzebne są oba warunki: bezwzględny limit **i** stosunek `rozpakowane : archiwum` (100:1). Pierwsza wersja miała tylko sufit i przepuściła bombę, bo ta trafiła dokładnie w granicę (`>` zamiast `>=`).

22. **Rozszerzenia trzeba filtrować w OBIE strony.** Publikowanie brało tylko `ALLOWED_EXTENSIONS`, ale instalacja zapisywała z archiwum cokolwiek — `.js`, `.exe`, pliki bez rozszerzenia i dotfile'y niewidoczne w panelu plików. Asymetria „wolno mniej wysłać, niż wolno przyjąć" jest zawsze błędem, nawet gdy oba końce pisze ta sama osoba.

23. **Adres API nie jest ustawieniem — wybiera go build.** Dopóki był polem tekstowym, był wektorem phishingu na jedno wklejenie: token leci nagłówkiem pod ten adres, więc „ustaw adres na …, żeby dostać paczkę X" oddawało konto. Dziś `esbuild.config.mjs` podstawia `__API_BASE_URL__` przez `define` (localhost w `npm run dev`, produkcyjny worker w `npm run build`, `MARKETPLACE_API_URL` ponad jednym i drugim), a `src/constants.ts` wystawia to jako `API_BASE_URL`. Kontrola adresu stoi teraz w **dwóch** miejscach i to jest świadome: `assertSafeApiUrl()` w `esbuild.config.mjs` wywala build na złym adresie, bliźniacza funkcja w `api/api.ts` zostaje jako ostatnia bramka i jako normalizacja końcowego ukośnika. Zmieniając warunki, zmień oba — esbuild nie widzi modułów TS-a. Deklaracja `declare const __API_BASE_URL__` siedzi w `constants.ts`, więc sięgnięcie po tę stałą gdziekolwiek indziej nie przejdzie przez `tsc`.

## Testowanie bez Obsidiana

Logikę `installs.ts` i `packagesApi.ts` można sprawdzić headlessowo: podmienia się moduł `obsidian` na atrapę, a `app.vault` na mapę `ścieżka → zawartość`.

Instalacja jest rozbita na dwa kroki właśnie po to, żeby dało się ją testować i żeby
dało się o nią zapytać użytkownika: `inspectArchive()` waliduje i skanuje, niczego nie
zapisując, a `installPlan()` zapisuje sprawdzony już plan. Test malware'u kończy się
na pierwszym kroku i nie potrzebuje atrapy vaulta w ogóle. Atrapa musi eksportować `normalizePath` oraz klasy używane jako wartości (`Modal`, `Setting`, `PluginSettingTab`, `ButtonComponent`, `Notice`, `Plugin`, `App`, `TFile`, `TFolder`).

**Atrapa `requestUrl` musi przekazywać `headers`.** Jeśli tego nie zrobi, testy uwierzytelniania po cichu pojadą bez tokenu, a przypadki „ma być 401" przejdą z zupełnie złego powodu. Warto to zaasertować wprost: zarejestruj konto i sprawdź, że `/me` zwraca 200. `requestUrl` da się odwzorować na node'owym `fetch`, co pozwala testować cały łańcuch przeciwko działającemu `wrangler dev`.

```bash
npx esbuild harness.ts --bundle --platform=node --format=esm --outfile=harness.mjs \
  --alias:obsidian=./obsidian-stub.js --alias:jszip="$PWD/node_modules/jszip" && node harness.mjs
```

Zakładkę ustawień da się wyrenderować headlessowo, z bogatszą atrapą (`Setting` zbierające
nazwy i przyciski, `PluginSettingTab` z atrapą `containerEl`). To jedyny sposób, żeby złapać
błędy renderowania — `tsc` przepuszcza i martwą strefę czasową, i brakujące przyciski.
Warto asertować, że `display()` **nie rzuca** w obu stanach (z tokenem i bez) oraz że
kluczowe przyciski istnieją.

Złośliwe archiwum do testów zip-slip trzeba zbudować **poza JSZipem** — JSZip normalizuje ścieżki również przy zapisie, więc test zbudowany jego API niczego nie dowodzi. Pamiętaj przy tym o minie 18: przy *odczycie* JSZip też normalizuje, więc wariant z `../` sprawdzaj na backendzie (`inspectZip`), a nie we wtyczce:

```bash
python3 -c "import zipfile; z=zipfile.ZipFile('/tmp/evil.zip','w'); z.writestr('../../../hacked.md','x'); z.writestr('..\\\\..\\\\win.md','x'); z.writestr('/abs/root.md','x'); z.close()"
```

## Konwencje

- **Wszystko po angielsku — kod, komentarze i UI, w obu repo.** Do niedawna wszystko szło po polsku, potem samo UI przeszło na angielski, teraz komentarze dołączyły. Dotyczy: `Notice`, `setName`/`setDesc`, tekstów przycisków, tytułów modali, komunikatów błędów (w tym tych zwracanych przez backend jako `{"error": ...}`) oraz komentarzy `//` i `/** */` w plikach `.ts` po obu stronach, łącznie z migracjami SQL. Komentarze celowo skrócone względem wcześniejszej wersji — jedno-dwa zdania z samą istotą "dlaczego", bez opowiadania historii incydentu krok po kroku. Zmianę treści błędów trzeba wdrożyć razem z backendem — inaczej `Notice()` we wtyczce pokazywałby mieszankę języków; sama zmiana komentarzy nie wymaga wdrożenia (znikają przy bundlowaniu). **Ten plik (CLAUDE.md) i pliki w `docs/` zostają po polsku** — nie zostały objęte tą zmianą. Lintowa reguła `obsidianmd/ui/sentence-case` wymaga wielkiej litery na początku opisów w ustawieniach.
- Komentarz tłumaczy **dlaczego**, nie **co**. Istniejący kod trzyma ten poziom — dopasuj się do niego.
- Taby, pojedyncze cudzysłowy, przecinki końcowe.
- `main.ts` zostaje wyłącznie cyklem życia; logika idzie do osobnych modułów.
- `AGENTS.md` w tym repo to ogólne zasady pluginów Obsidiana (z szablonu). Ten plik jest warstwą specyficzną dla projektu — przy sprzeczności wygrywa ten plik.
- `README.md` jest nadal z szablonu `obsidian-sample-plugin` i **nie opisuje tego projektu**. Nie cytuj go jako źródła prawdy.
- [docs/publikowanie.md](docs/publikowanie.md) opisuje przepływ **sprzed** przeglądu zawartości: rozdział 6 twierdzi, że `findBrokenLinks()` widzi wyłącznie linki wychodzące poza zestaw, a rozdział 3, że walidacja blokuje publikację przez `Notice`. Rozdziały 8, 11 i 14 czytają adres z `settings.apiBaseUrl` — tego pola już nie ma. Reszta (pakowanie, multipart, kodowanie) trzyma się nadal.
