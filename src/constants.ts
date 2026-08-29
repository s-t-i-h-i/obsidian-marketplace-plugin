/** Rozszerzenia, które wolno spakować i które wolno rozpakować. Jedna lista dla obu stron. */
export const ALLOWED_EXTENSIONS = ['md', 'canvas', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];

/**
 * Domyślny adres marketplace'u.
 *
 * Pusty do czasu wdrożenia produkcyjnego workera — wtedy wpisz tu adres https://.
 * Sens tej stałej jest taki, że zwykły użytkownik nie powinien wpisywać adresu API
 * ręcznie: pole tekstowe, w które da się wkleić cudzy serwer, to gotowy phishing
 * na token (patrz `assertSafeApiUrl` w api/api.ts).
 */
export const DEFAULT_API_BASE_URL = '';

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
