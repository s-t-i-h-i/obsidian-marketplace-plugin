/** Rozszerzenia, które wolno spakować i które wolno rozpakować. Jedna lista dla obu stron. */
export const ALLOWED_EXTENSIONS = ['md', 'canvas', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];

/**
 * Adres marketplace'u, wstawiany przez esbuild (`define` w esbuild.config.mjs).
 *
 * `npm run dev` wkompilowuje localhost, `npm run build` produkcyjnego workera,
 * a zmienna MARKETPLACE_API_URL nadpisuje jedno i drugie. W ustawieniach tego
 * nie ma świadomie: token leci nagłówkiem pod ten adres, więc pole tekstowe,
 * w które da się wkleić cudzy serwer, było gotowym phishingiem na konto (mina 23).
 *
 * Deklaracja stoi tutaj, a nie w osobnym .d.ts, żeby stała i jej jedyne źródło
 * były w jednym miejscu - użycie `__API_BASE_URL__` gdziekolwiek indziej nie
 * przejdzie przez tsc.
 */
declare const __API_BASE_URL__: string;
export const API_BASE_URL = __API_BASE_URL__;

// --- limity archiwum przy pobieraniu ---

/** Górna granica samego pliku ZIP. Serwer trzyma 50 MB, zostawiamy zapas. */
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

/** Ile bajtów wolno zapisać do vaulta po rozpakowaniu. Bez tego 204 kB archiwum robi 200 MB plików. */
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/**
 * Górna granica stosunku "dane po rozpakowaniu : rozmiar archiwum".
 *
 * Sam sufit bajtów nie wystarcza: archiwum mieszczące się tuż pod nim wciąż jest
 * bombą, jeśli waży 200 kB. Dobrze ściśnięty tekst osiąga ~10:1, więc 100:1 nie
 * przeszkadza żadnej prawdziwej paczce.
 */
export const MAX_COMPRESSION_RATIO = 100;

/** Ile plików najwyżej. Tyle samo, ile przyjmuje worker. */
export const MAX_ENTRIES = 2000;

/** Długość ścieżki wewnątrz paczki. Windows przewraca się na MAX_PATH ~260 znaków. */
export const MAX_ENTRY_PATH = 400;

/** Zagnieżdżenie folderów. 300 poziomów to nie struktura kursu, tylko złośliwość. */
export const MAX_ENTRY_DEPTH = 32;

/** Nazwa folderu paczki. Systemy plików trzymają limit 255 bajtów na segment. */
export const MAX_FOLDER_NAME = 80;
