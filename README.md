# Atlas Journal v7.3 MapTiler

Jurnal de călătorie web cu:

- glob 3D MapTiler;
- orașe, localități, granițe și drumuri;
- teren 3D;
- căutare după oraș / adresă;
- selectare locație direct pe hartă;
- calendar;
- călătorii pe mai multe zile;
- itinerarii cu mai multe opriri;
- fotografii;
- sincronizare EtherCalc;
- interfață responsive pentru desktop, tabletă și mobil.

## Fișiere

- `index.html` — pagina principală;
- `styles.css` — toate stilurile aplicației;
- `app.js` — logica aplicației;
- `atlas_journal_ALL_IN_ONE_v7_3_MAPTILER.html` — varianta cu totul într-un singur fișier.

## MapTiler

Cheia implicită inclusă în proiect este:

`wR04Ry5AoaXtixELEHFx`

Aplicația permite în continuare schimbarea cheii din interfață. Dacă există o cheie salvată în `localStorage`, aceasta are prioritate față de cheia implicită.

Pentru publicare este recomandat să restricționezi cheia MapTiler la domeniul pe care rulează aplicația.

## Publicare

Pune în același folder:

- `index.html`
- `styles.css`
- `app.js`

Apoi publică folderul prin GitHub Pages sau alt hosting static.

## Variante `.txt`

În folder sunt incluse și copii `.txt` ale tuturor fișierelor principale, utile când platforma nu permite descărcarea directă a fișierelor `.html`, `.css` sau `.js`.
