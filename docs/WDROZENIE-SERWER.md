# Gra na własnym serwerze: krok po kroku

Efekt: gra pod adresem **https://gra.TWOJADOMENA.pl**. Po każdej zmianie w kodzie wgrywa się na serwer sama, po około 5–8 minutach.

W całej instrukcji:
- **TWOJADOMENA.pl** to Twoja domena (np. `alienvtt.co.uk`). Wpisuj swoją.
- **gra** to nazwa subdomeny. Może być inna, ale wtedy zmieniaj ją wszędzie.
- **88.208.226.157** to adres Twojego serwera (IONOS, „Alien VTT”).

Nic z tego nie rusza Twoich innych projektów na serwerze. Wszystko trafia do jednego, nowego katalogu.

---

## Krok 1. Adres subdomeny (DNS), 5 minut

Domena musi wiedzieć, że `gra.TWOJADOMENA.pl` prowadzi do Twojego serwera.

**Jeśli domena jest w IONOS:**
1. Wejdź na https://my.ionos.co.uk i zaloguj się.
2. Kliknij **Domains & SSL**, a potem swoją domenę.
3. Wejdź w zakładkę **DNS** i kliknij **Add record**, a potem **A**.
4. Wypełnij pola:
   - **Host name:** `gra`
   - **Points to:** `88.208.226.157`
   - **TTL:** zostaw domyślne
5. Kliknij **Save**.

**Jeśli domena jest gdzie indziej** (OVH, home.pl, Cloudflare…), zrób to samo w panelu DNS tamtej firmy: rekord **A**, nazwa `gra`, wartość `88.208.226.157`.

Rekord zaczyna działać po kilku minutach, czasem po godzinie.

**Sprawdzenie:** na swoim komputerze otwórz PowerShell i wpisz:

```
nslookup gra.TWOJADOMENA.pl
```

Musi się pojawić `88.208.226.157`.

---

## Krok 2. Subdomena na serwerze, 5 minut

Twój serwer ma otwarte porty 8443 i 8447. To prawie na pewno znaczy, że jest na nim panel **Plesk**.

1. Otwórz w przeglądarce https://88.208.226.157:8443
   - Przeglądarka może ostrzec o certyfikacie. Kliknij **Zaawansowane**, a potem **Kontynuuj**.
2. Zaloguj się do Pleska.
3. Po lewej kliknij **Websites & Domains**, a potem przycisk **Add Subdomain**.
4. Wypełnij pola:
   - **Subdomain name:** `gra`. Obok wybierz swoją domenę z listy.
   - **Document root:** zostaw to, co Plesk podpowie, zwykle `gra.TWOJADOMENA.pl`.
5. Kliknij **OK**.
6. Przy nowej subdomenie kliknij **SSL/TLS Certificates**, potem przy Let's Encrypt **Get it free**, potem **Get it free** jeszcze raz.
   - Jeśli wyskoczy błąd, DNS z kroku 1 jeszcze nie działa. Spróbuj za pół godziny.
7. **Zapisz pełną ścieżkę katalogu strony.**
   - Przy subdomenie kliknij **Hosting & DNS**, potem **Hosting Settings**. Ścieżka jest w polu **Document root**.
   - Pełna ścieżka wygląda zwykle tak: `/var/www/vhosts/TWOJADOMENA.pl/gra.TWOJADOMENA.pl`
   - Będzie potrzebna w kroku 4.

Jeśli Twojej domeny nie ma w Plesku na liście, najpierw kliknij **Add Domain**, dodaj domenę i dopiero wtedy wróć do punktu 3.

> **Nie ma Pleska?** Jeśli pod `:8443` nic się nie otwiera, napisz mi. Wtedy przygotuję wersję z samym nginx. Po zalogowaniu na serwer (krok 3) możesz to sprawdzić poleceniem `ls /etc/nginx/sites-enabled`.

---

## Krok 3. Klucz do automatycznego wgrywania, 10 minut

GitHub (tam, gdzie leży kod gry) musi móc wgrywać pliki na serwer. Dostanie do tego specjalny klucz zamiast hasła.

1. Na swoim komputerze otwórz **PowerShell**: menu Start, wpisz „PowerShell”, Enter.
2. Połącz się z serwerem:

   ```
   ssh root@88.208.226.157
   ```

   - Na pytanie `Are you sure you want to continue connecting` wpisz `yes` i Enter.
   - Podaj hasło roota. W panelu IONOS jest pod **View password** (Twój drugi zrzut).
   - Hasło się nie wyświetla podczas pisania, to normalne. Możesz je wkleić prawym przyciskiem myszy i nacisnąć Enter.

3. Jesteś na serwerze. Wklej po kolei te polecenia, każde zatwierdzając Enterem:

   ```
   apt-get install -y rsync
   ```

   ```
   ssh-keygen -t ed25519 -N "" -C github-moje-miasto -f ~/.ssh/moje_miasto_deploy
   ```

   ```
   cat ~/.ssh/moje_miasto_deploy.pub >> ~/.ssh/authorized_keys
   ```

   ```
   cat ~/.ssh/moje_miasto_deploy
   ```

4. Ostatnie polecenie wypisze klucz prywatny:
   - zaczyna się od `-----BEGIN OPENSSH PRIVATE KEY-----`,
   - kończy się na `-----END OPENSSH PRIVATE KEY-----`.

   Zaznacz myszką **całość, razem z tymi dwiema liniami** i skopiuj (Ctrl+C albo prawy przycisk).
   **Nikomu tego nie wysyłaj, także mnie na czacie.** Wklejasz to tylko w GitHub w kroku 4.

5. Wpisz `exit`, żeby się rozłączyć.

---

## Krok 4. Ustawienia w GitHub, 5 minut

1. Otwórz https://github.com/MrFischoeder/moje_miasto/settings/secrets/actions
2. Kliknij **New repository secret** i dodaj kolejno cztery sekrety. Po każdym kliknij **Add secret**.

| Name (dokładnie tak) | Secret (wartość) |
|---|---|
| `DEPLOY_SSH_KEY` | klucz skopiowany w kroku 3 (cały, z liniami BEGIN/END) |
| `DEPLOY_HOST` | `88.208.226.157` |
| `DEPLOY_PATH` | pełna ścieżka z kroku 2, np. `/var/www/vhosts/TWOJADOMENA.pl/gra.TWOJADOMENA.pl` |
| `DEPLOY_USER` | `root` |

Sekrety są tajne. Nikt ich nie zobaczy, nawet w publicznym repozytorium.

---

## Krok 5. Pierwsze wgranie

1. Otwórz https://github.com/MrFischoeder/moje_miasto/actions
2. Po lewej kliknij **Build**, potem po prawej **Run workflow**.
3. Wybierz gałąź **etap-uproszczenie** i kliknij zielone **Run workflow**.
4. Poczekaj 5–8 minut. Gdy oba kroki, **build** i **deploy**, mają zielony ptaszek, wejdź na **https://gra.TWOJADOMENA.pl**.

Od teraz każda zmiana, którą wypchnę do repozytorium, wgra się sama, po kilku minutach. Gdy chcesz zobaczyć nowość, odśwież stronę gry z wyczyszczeniem pamięci: **Ctrl+F5**.

---

## Co jest na serwerze

- **Wersja przeglądarkowa gry** (tryb jednoosobowy): **cała Warszawa**. Mapa doczytuje się kawałkami z serwera, w przeciwieństwie do paczki .zip, która miała tylko centrum.
- Około 50 MB plików w katalogu subdomeny. Nic więcej nie jest instalowane ani uruchamiane.
- Tryb wieloosobowy (osobny program serwera gry) to następny krok, gdy zechcesz.

## Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| Na Actions czerwony krzyżyk przy **deploy** | Kliknij go, potem **Wgranie na serwer**. Przyślij mi zrzut tego, co jest na czerwono. **Nie przysyłaj kluczy ani haseł.** |
| „Katalog nie wygląda na nowy katalog subdomeny” | Sprawdź `DEPLOY_PATH`: to zabezpieczenie przed nadpisaniem innego projektu. Ścieżka musi wskazywać katalog **nowej** subdomeny. |
| „Permission denied (publickey)” | Klucz w `DEPLOY_SSH_KEY` jest niepełny. Skopiuj go jeszcze raz (krok 3, punkt 4) i podmień sekret. |
| Strona pokazuje domyślną stronę Pleska | Wgranie jeszcze nie przeszło albo `DEPLOY_PATH` wskazuje inny katalog. |
| Przeglądarka: „niezabezpieczone połączenie” | Brak certyfikatu. Powtórz krok 2, punkt 6. |
