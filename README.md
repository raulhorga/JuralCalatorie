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
- export complet Excel (`.xlsx`) si fotografii in arhiva ZIP;
- sincronizare EtherCalc;
- interfață responsive pentru desktop, tabletă și mobil.

## Export

Butonul **Export Excel + ZIP**, din zona de date de la finalul paginii, descarca
doua fisiere: un Excel cu foile `Calatorii`, `Opriri` si `Fotografii`, plus un ZIP
cu toate imaginile stocate, organizate pe calatorii. Foaia `Fotografii` include
calea fiecarei imagini din arhiva. Exportul include toate calatoriile incarcate,
indiferent de filtrul de cautare, si nu modifica datele din EtherCalc.

Asteapta finalizarea sincronizarii inainte de export. Bibliotecile ExcelJS si
JSZip se incarca la prima apasare, deci este necesara o conexiune la internet.
Permite descarcarile multiple daca browserul solicita acest lucru. Fara imagini,
arhiva ZIP este goala. Imaginile exportate sunt versiunile comprimate deja stocate
in jurnal, nu fisierele originale de dinaintea incarcarii.

## Fișiere

- `index.html` — pagina principală;
- `styles.css` — toate stilurile aplicației;
- `app.js` — logica aplicației;

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

