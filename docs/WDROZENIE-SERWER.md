# Gra na własnym serwerze: krok po kroku

Efekt: gra pod adresem **https://mycity.terminalzero.uk**. Po każdej zmianie w kodzie serwer sam pobiera nową wersję, po około 5–8 minutach.

Nie trzeba kopiować żadnych kluczy ani haseł do GitHuba:
- GitHub po każdej zmianie (i udanych testach) odkłada gotową grę na gałąź `serwer`;
- Twój serwer co 2 minuty sprawdza, czy jest tam coś nowego, i pobiera to.

Twoich innych projektów to nie dotyka. Gra trafia do jednego, nowego katalogu subdomeny.

---

## Krok 1. Rekord DNS (jedyna rzecz w przeglądarce)

Subdomena musi prowadzić do Twojego serwera.

1. Wejdź na https://my.ionos.co.uk i zaloguj się. Jeśli domena `terminalzero.uk` jest w innej firmie, zrób to samo w jej panelu DNS.
2. Kliknij **Domains & SSL**, potem `terminalzero.uk`, potem zakładkę **DNS**.
3. Kliknij **Add record**, potem **A**, i wypełnij:
   - **Host name:** `mycity`
   - **Points to:** `88.208.226.157`
4. Kliknij **Save**.

Rekord zaczyna działać po kilku minutach, czasem po godzinie. Możesz przejść od razu do kroku 2. Skrypt sam sprawdzi DNS i powie, czy trzeba go uruchomić jeszcze raz.

---

## Krok 2. Jedno polecenie na serwerze

1. Na komputerze otwórz **PowerShell**: menu Start, wpisz „PowerShell”, Enter.
2. Zaloguj się na serwer:

   ```
   ssh root@88.208.226.157
   ```

   - Na pytanie `Are you sure...` wpisz `yes`.
   - Hasło roota jest w panelu IONOS pod **View password**.
   - Hasło się nie wyświetla podczas pisania. Wklejasz je prawym przyciskiem myszy i naciskasz Enter.

3. Wklej to polecenie (prawy przycisk myszy) i naciśnij Enter:

   ```
   curl -fsSL https://raw.githubusercontent.com/MrFischoeder/moje_miasto/etap-uproszczenie/tools/serwer-instalacja.sh | bash -s -- mycity.terminalzero.uk
   ```

Skrypt sam robi kolejno:
- sprawdza DNS;
- zakłada subdomenę. Najpierw wykrywa, czego używa serwer: Plesk, nginx albo Apache;
- zakłada certyfikat HTTPS (gdy DNS już działa);
- pobiera grę;
- ustawia automatyczne aktualizacje co 2 minuty.

Na końcu napisze **Gotowe** i poda adres gry.

**Jeśli napisze, że DNS jeszcze nie wskazuje na serwer:** odczekaj kwadrans i wklej **to samo polecenie jeszcze raz**. Wtedy doda HTTPS. Można je uruchamiać dowolnie wiele razy.

4. Wpisz `exit`, żeby się rozłączyć.

---

## Krok 3. Gra

Otwórz **https://mycity.terminalzero.uk**.

Gdy wprowadzę zmianę, po 5–8 minutach jest na serwerze. Odśwież stronę gry przez **Ctrl+F5**.

---

## Przydatne polecenia (na serwerze, po `ssh root@88.208.226.157`)

| Co | Polecenie |
|---|---|
| Kiedy i co ostatnio się wgrało | `tail /var/log/moje-miasto.log` |
| Wgraj najnowszą wersję od razu, bez czekania | `moje-miasto-aktualizuj --force` |
| Wyłącz automatyczne aktualizacje | `rm /etc/cron.d/moje-miasto` |
| Włącz je z powrotem | wklej jeszcze raz polecenie z kroku 2 |

## Co jest na serwerze

- **Wersja przeglądarkowa gry** (tryb jednoosobowy): **cała Warszawa**. Mapa doczytuje się kawałkami, w przeciwieństwie do paczki .zip, która miała tylko centrum.
- Około 50 MB w katalogu subdomeny i kopia w `/opt/moje-miasto`.
- Brak działających programów. Jest tylko wpis w harmonogramie: `/etc/cron.d/moje-miasto`.
- Tryb wieloosobowy (osobny program serwera gry) to następny krok, gdy zechcesz.

## Gdy coś nie działa

Skopiuj ostatnie linijki z okna PowerShell, te na czerwono lub żółto, i przyślij mi. **Nie przysyłaj hasła roota.**

| Komunikat | Co zrobić |
|---|---|
| „Domeny terminalzero.uk nie ma w Plesku” | W Plesku (https://88.208.226.157:8443) dodaj domenę: **Websites & Domains**, potem **Add Domain**. Potem powtórz krok 2. |
| „Port 80 zajmuje program …” | Twój serwer używa czegoś innego niż Plesk, nginx i Apache. Przyślij mi tę linijkę, dopasuję instalację. |
| „… zawiera N plików innej strony – nie nadpisuję” | To zabezpieczenie: katalog subdomeny nie jest pusty. Przyślij mi tę linijkę. |
| Certyfikat nie wyszedł | DNS jeszcze nie działa. Odczekaj i powtórz krok 2. |
