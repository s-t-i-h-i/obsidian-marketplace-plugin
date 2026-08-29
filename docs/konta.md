# Konta i tokeny — przewodnik

Jak działa logowanie w marketplace, co robi każdy przycisk i co się dzieje pod spodem.

## Spis treści

1. [Model w jednym akapicie](#1-model-w-jednym-akapicie)
2. [Pierwsze konto](#2-pierwsze-konto)
3. [Publikowanie paczki](#3-publikowanie-paczki)
4. [Przeglądanie, filtrowanie, pobieranie](#4-przegladanie-filtrowanie-pobieranie)
5. [Drugie urządzenie](#5-drugie-urzadzenie)
6. [Token wyciekł — rotacja](#6-token-wyciekl--rotacja)
7. [Wylogowanie i powrót](#7-wylogowanie-i-powrot)
8. [Zamknięcie konta](#8-zamkniecie-konta)
9. [Co się dzieje pod spodem](#9-co-sie-dzieje-pod-spodem)
10. [Czego ten system nie robi](#10-czego-ten-system-nie-robi)

---

## 1. Model w jednym akapicie

Nie ma haseł ani e-maili. Przy zakładaniu konta **serwer losuje token** (`omp_` +
64 znaki hex) i pokazuje go **dokładnie raz**. Ten token jest jedynym poświadczeniem:
wtyczka dokleja go do każdego żądania w nagłówku `Authorization: Bearer ...`, a serwer
po nim rozpoznaje, kim jesteś. W bazie nie leży sam token, tylko jego skrót SHA-256 —
wyciek bazy nie daje nikomu niczego, czym dałoby się zalogować.

Konsekwencja, którą trzeba znać od razu: **zgubiony token to zgubione konto.** Nie ma
„przypomnij hasło". Dlatego wtyczka pozwala token podejrzeć i skopiować, a wylogowanie
domyślnie go **nie** kasuje.

---

## 2. Pierwsze konto

Ustawienia → *Marketplace Plugin*.

Adresu serwera nie ustawiasz — jest wkompilowany w wersję wtyczki, którą masz
zainstalowaną, i widnieje w opisie pola z tokenem. Konta są per serwer: token
z builda deweloperskiego (localhost) nie zadziała na produkcji i odwrotnie.

1. **Załóż nowe konto** — wpisz nazwę (3–32 znaki, `a-z A-Z 0-9 _ -`) i kliknij
   **Załóż konto**.
2. Token ląduje w polu **Twój token** i od razu jest zapisany w `data.json`.
   Komunikat zostaje na ekranie, dopóki go nie klikniesz.
3. **Zapisz token teraz.** Kliknij ikonę oka, żeby go zobaczyć, i ikonę kopiowania,
   żeby wrzucić go do menedżera haseł. Serwer nie pokaże go drugi raz.

Nazwy są unikalne bez względu na wielkość liter — jeśli istnieje `adi`, to `ADI`
dostanie `409 Nazwa zajęta`. To celowe: inaczej podszycie się pod kogoś byłoby darmowe.

Rejestracja jest ograniczona do **3 prób na minutę z jednego adresu IP**.

---

## 3. Publikowanie paczki

1. Prawy przycisk na folderze w vaulcie → **Publikuj**.
2. Zanim formularz się otworzy, wtyczka sprawdza po kolei: czy jest adres API,
   czy jesteś zalogowany, czy folder ma pliki i czy nie ma uszkodzonych linków.
   Odbicie na tym etapie jest celowe — lepiej niż wypełnić formularz i dopiero
   wtedy usłyszeć „zaloguj się".
3. Wypełnij **Tytuł**, **Opis** i **Tagi** (po przecinku).
   **Nie ma pola „Autor"** — autora serwer bierze z tokenu. Gdybyś dopisał `author`
   ręcznie do żądania, zostanie zignorowany.
4. **Publikuj**. Wtyczka pakuje folder ZIP-em i wysyła go razem z listą ścieżek,
   dzięki czemu inni zobaczą strukturę paczki bez pobierania jej.

Limit: **10 paczek na dobę na konto**, maks. 50 MB na paczkę.

---

## 4. Przeglądanie, filtrowanie, pobieranie

Paleta poleceń → **Open marketplace**. Przeglądanie i pobieranie **nie wymagają
logowania** — token jest potrzebny tylko do publikowania i kasowania.

- Rozwijana lista **tagów** pokazuje tylko te tagi, które faktycznie występują w katalogu.
- Druga lista sortuje: *Najnowsze / Najstarsze / Tytuł A-Z*.
- **Kliknięcie kafelka** otwiera szczegóły: opis autora w całości, klikalne tagi
  i **drzewo plików** paczki. Kliknięcie taga wraca do listy już przefiltrowanej.
- **Pobierz** rozpakowuje paczkę do folderu z ustawień. Archiwum jest najpierw
  w całości sprawdzane, a dopiero potem cokolwiek trafia na dysk.
- Przy **własnych** paczkach pojawia się **Usuń** (dwa kliknięcia: `Usuń` → `Na pewno?`).
  To tylko podpowiedź interfejsu — właściciela i tak weryfikuje serwer.

---

## 5. Drugie urządzenie

Nie przenoś tego samego tokenu na dwa komputery — wydaj osobny.

1. Na urządzeniu, na którym jesteś zalogowany: **Zaawansowane → Token dla innego
   urządzenia → Wydaj nowy**.
2. Nowy token pokazuje się na ekranie i trafia do schowka.
3. Na drugim urządzeniu: wpisz adres API, wklej token w **Mam już token**,
   kliknij **Zaloguj**.

Konto może mieć najwyżej **10 tokenów**. Osobne tokeny znaczą tyle, że możesz
unieważnić jeden z nich, nie ruszając reszty.

---

## 6. Token wyciekł — rotacja

Kolejność ma znaczenie. **Najpierw wyrób nowy, dopiero potem unieważnij stary** —
odwrotnie zostaniesz bez dostępu.

1. **Zaawansowane → Wydaj nowy**. Zapisz go.
2. Wklej nowy token w pole **Twój token**.
3. **Zaawansowane → Unieważnij ten token → Na pewno?**

Opis przycisku ostrzega, gdy to jedyny token konta. Liczbę tokenów sprawdzisz
przyciskiem **Odśwież**.

---

## 7. Wylogowanie i powrót

To są **dwie różne** rzeczy i dlatego mają dwa różne przyciski:

| Przycisk | Co robi | Odwracalne? |
|---|---|---|
| **Wyloguj z tego urządzenia** | czyści token tylko z `data.json` | **tak** — wklej token i kliknij *Zaloguj* |
| **Zaawansowane → Unieważnij ten token** | kasuje token na serwerze | **nie** |

Powrót na konto:

1. **Mam już token** — wklej token.
2. **Zaloguj**. Wtyczka odpytuje `/me`, odtwarza nazwę i identyfikator konta,
   dzięki czemu „Usuń" znowu pojawia się przy Twoich paczkach.

Jeśli nie zapisałeś tokenu i go unieważniłeś, konta nie da się odzyskać z poziomu
wtyczki — zostaje ręczna interwencja w bazie po stronie operatora.

---

## 8. Zamknięcie konta

**Zaawansowane → Zamknij konto → Skasować wszystko?**

Kasuje w jednej transakcji: konto, **wszystkie jego tokeny** i **wszystkie jego
paczki** (wpisy w bazie oraz pliki ZIP). Nazwa użytkownika wraca do puli i ktoś inny
może ją zająć.

Kolejność jest wymuszona przez bazę: paczki muszą zniknąć przed kontem, bo klucz obcy
`packages.author_id` blokuje usunięcie użytkownika, który wciąż coś posiada.

---

## 9. Co się dzieje pod spodem

Publikacja z tokenem, krok po kroku:

```
Wtyczka                                   Worker
───────                                   ──────
publishModal        sprawdza token
publishApi          pakuje ZIP (JSZip)
                    liczy listę ścieżek
api.ts              dokleja Authorization
                    POST /publish  ───────►  authenticate()  ── zły token ──► 401
                                             (SHA-256 → tabela tokens,
                                              odsiew regexem PRZED bazą,
                                              kontrola is_banned)
                                                   │
                                             formData()   ← dopiero teraz, żeby
                                                   │        anonim nie zmusił
                                                   │        serwera do 50 MB
                                             limit dobowy (D1)
                                             R2.put(ZIP)
                                             D1.insert(author = z tokenu)
                    ◄─────────  201 {id, filename, author}
```

Trzy rzeczy, które warto stąd wynieść:

- **Autor nigdy nie pochodzi z formularza.** To jedyny powód, dla którego katalog
  w ogóle coś znaczy.
- **Uwierzytelnianie idzie przed parsowaniem ciała**, więc żądanie bez tokenu
  nie kosztuje serwera przemielenia archiwum.
- **Token jedzie nagłówkiem, nie polem formularza.** Wartości pól trafiają do ciała
  multipart bez escapowania, więc sekret nie ma tam czego szukać.

---

## 10. Czego ten system nie robi

Świadome ograniczenia — warto je znać, zanim się na nich potkniesz:

- **Token leży otwartym tekstem** w `data.json` wewnątrz vaulta. Wtyczki Obsidiana nie
  są od siebie odizolowane, a synchronizacja vaulta skopiuje token razem z notatkami.
- **Tokeny nie wygasają** i nie rotują się same.
- **Nie ma odzyskiwania konta** — brak e-maila i hasła.
- **Zawartość ZIP-a nie jest sprawdzana na serwerze.** Jedyną barierą jest walidacja
  ścieżek w `installs.ts` po stronie wtyczki, przy rozpakowywaniu.
- **Nie ma panelu moderacji.** Ban ustawia się flagą `is_banned` przez `wrangler d1 execute`.
- **Limit rejestracji działa po IP**, więc NAT i VPN dzielą jeden licznik.
