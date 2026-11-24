#!/usr/bin/env bash
# Instalacja gry "Moje miasto" na własnym serwerze (Ubuntu/Debian), jednym poleceniem jako root:
#   curl -fsSL https://raw.githubusercontent.com/MrFischoeder/moje_miasto/etap-uproszczenie/tools/serwer-instalacja.sh | bash -s -- mycity.terminalzero.uk
# Co robi:
#   1. sprawdza DNS subdomeny,
#   2. zakłada stronę (Plesk, nginx albo Apache – to, co już jest na serwerze; inne strony nie są ruszane) i certyfikat HTTPS,
#   3. pobiera gotową grę z GitHub (gałąź "serwer") i co 2 minuty sprawdza, czy jest nowsza wersja.
# Można uruchamiać wielokrotnie (np. po dodaniu rekordu DNS, żeby dostać certyfikat).
set -euo pipefail

FQDN="${1:-mycity.terminalzero.uk}"; SUB="${FQDN%%.*}"; DOMAIN="${FQDN#*.}"
REPO=https://github.com/MrFischoeder/moje_miasto.git
SRC=/opt/moje-miasto; UPD=/usr/local/bin/moje-miasto-aktualizuj; CONF=/etc/moje-miasto.conf

say()  { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mBŁĄD: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Uruchom jako root (zaloguj się: ssh root@ADRES_SERWERA)."
[ "$SUB" != "$FQDN" ] && [ -n "$DOMAIN" ] || die "Podaj pełną nazwę subdomeny, np. mycity.terminalzero.uk"

say "1/5 Pakiety (git, rsync)"
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null && command -v rsync >/dev/null && command -v curl >/dev/null || { apt-get update -qq; apt-get install -y -qq git rsync curl >/dev/null; }
echo "ok"

say "2/5 DNS: czy $FQDN wskazuje na ten serwer"
MYIP=$(curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DNSIP=$(getent ahostsv4 "$FQDN" 2>/dev/null | awk 'NR==1{print $1}' || true)
DNS_OK=0
if [ "$DNSIP" = "$MYIP" ]; then DNS_OK=1; echo "ok: $FQDN -> $MYIP"
else
  warn "$FQDN wskazuje na: '${DNSIP:-nic}', a ten serwer to $MYIP."
  warn "Dodaj w panelu DNS domeny $DOMAIN rekord typu A: nazwa '$SUB', wartość '$MYIP'."
  warn "Strona i tak zostanie założona; po dodaniu rekordu uruchom to polecenie jeszcze raz (doda HTTPS)."
fi

say "3/5 Strona $FQDN"
OWNER=""
if command -v plesk >/dev/null 2>&1; then
  KIND=plesk; echo "Wykryto Plesk."
  plesk bin domain --info "$DOMAIN" >/dev/null 2>&1 || plesk bin site --info "$DOMAIN" >/dev/null 2>&1 || die "Domeny $DOMAIN nie ma w Plesku. Dodaj ją w panelu (Websites & Domains -> Add Domain) i uruchom polecenie ponownie."
  if plesk bin site --info "$FQDN" >/dev/null 2>&1 || plesk bin subdomain --info "$SUB" -domain "$DOMAIN" >/dev/null 2>&1; then echo "Subdomena już istnieje."
  else
    plesk bin subdomain --create "$SUB" -domain "$DOMAIN" -www-root "/$FQDN" >/dev/null 2>&1 \
      || plesk bin site --create "$FQDN" -webspace-name "$DOMAIN" -www-root "$FQDN" \
      || die "Plesk nie założył subdomeny. Załóż ją w panelu (Websites & Domains -> Add Subdomain: $SUB) i uruchom polecenie ponownie."
    echo "Założono subdomenę w Plesku."
  fi
  DOCROOT=$(plesk db -Ne "SELECT h.www_root FROM hosting h JOIN domains d ON d.id=h.dom_id WHERE d.name='$FQDN'" 2>/dev/null | head -1 || true)
  [ -n "$DOCROOT" ] && [ -d "$DOCROOT" ] || DOCROOT="/var/www/vhosts/$DOMAIN/$FQDN"
  [ -d "$DOCROOT" ] || die "Nie znalazłem katalogu strony ($DOCROOT). Sprawdź w Plesku: subdomena -> Hosting Settings -> Document root."
  OWNER=$(stat -c %U:%G "$DOCROOT")
  if [ $DNS_OK = 1 ]; then
    MAIL=$(plesk bin admin --info 2>/dev/null | awk -F': *' 'tolower($1) ~ /mail/ {print $2; exit}' || true)
    if plesk bin extension --exec letsencrypt cli.php -d "$FQDN" ${MAIL:+-m "$MAIL"} >/dev/null 2>&1; then echo "Certyfikat HTTPS: ok"
    else warn "Certyfikat nie wyszedł automatycznie. W Plesku: subdomena -> SSL/TLS Certificates -> Let's Encrypt -> Get it free."; fi
  fi
else
  # serwer bez Pleska: to, co nasłuchuje na porcie 80
  L80=$(ss -ltnpH 'sport = :80' 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2 || true)
  if [ -z "$L80" ] && pgrep -x nginx >/dev/null 2>&1; then L80=nginx; fi
  if [ -z "$L80" ] && pgrep -x apache2 >/dev/null 2>&1; then L80=apache2; fi
  case "$L80" in
    nginx*) KIND=nginx ;;
    apache2*|httpd*) KIND=apache ;;
    caddy*) KIND=caddy ;;
    "") KIND=nginx; echo "Na porcie 80 nic nie działa: instaluję nginx."; apt-get install -y -qq nginx >/dev/null; systemctl enable --now nginx >/dev/null 2>&1 || true ;;
    *) die "Port 80 zajmuje program '$L80' (nie nginx/Apache/Plesk). Napisz to Claude'owi – trzeba dopasować instalację." ;;
  esac
  echo "Serwer WWW: $KIND"
  DOCROOT="/var/www/$FQDN"; mkdir -p "$DOCROOT"
  if [ $KIND = caddy ]; then
    # Caddy: własny blok strony w Caddyfile (HTTPS Caddy załatwia sam); kopia zapasowa i sprawdzenie przed przeładowaniem
    command -v docker >/dev/null 2>&1 && docker ps --format '{{.Image}} {{.Ports}}' 2>/dev/null | grep -qi 'caddy' && die "Caddy działa w Dockerze – napisz to Claude'owi (trzeba dopisać stronę do konfiguracji kontenera)."
    systemctl is-active --quiet caddy 2>/dev/null || die "Caddy nie działa jako usługa systemowa 'caddy' – napisz to Claude'owi."
    CF=$(systemctl show -p ExecStart caddy 2>/dev/null | grep -o -- '--config [^ ;]*' | awk '{print $2}' | head -1 || true)
    CF=${CF:-/etc/caddy/Caddyfile}
    [ -f "$CF" ] || die "Nie znalazłem konfiguracji Caddy ($CF) – napisz to Claude'owi."
    case "$CF" in *.json) die "Caddy używa konfiguracji JSON ($CF) – napisz to Claude'owi.";; esac
    if grep -q "^$FQDN" "$CF"; then echo "Blok $FQDN już jest w $CF."
    else
      cp -a "$CF" "$CF.przed-moje-miasto.$(date +%Y%m%d%H%M%S)"
      cat >> "$CF" <<CDY

# Moje miasto (gra) – dopisane przez tools/serwer-instalacja.sh
$FQDN {
	root * $DOCROOT
	encode gzip
	@html path / /index.html
	header @html Cache-Control "no-cache"
	file_server
}
CDY
      if ! caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
        B=$(ls -t "$CF".przed-moje-miasto.* | head -1); cp -a "$B" "$CF"
        die "Caddy nie przyjął konfiguracji – przywróciłem poprzednią, nic się nie zmieniło. Napisz to Claude'owi."
      fi
      echo "Dopisano stronę do $CF (kopia zapasowa obok)."
    fi
    chmod 755 "$DOCROOT"
    systemctl reload caddy || die "Przeładowanie Caddy nie wyszło (systemctl status caddy)."
    echo "HTTPS: Caddy zakłada certyfikat sam przy pierwszym wejściu na stronę."
  elif [ $KIND = nginx ]; then
    if [ -d /etc/nginx/sites-available ]; then NCONF=/etc/nginx/sites-available/$FQDN; else NCONF=/etc/nginx/conf.d/$FQDN.conf; fi
    if [ ! -f "$NCONF" ]; then
      cat > "$NCONF" <<NGX
# Moje miasto (gra) – założone przez tools/serwer-instalacja.sh
server {
    listen 80;
$( [ -e /proc/net/if_inet6 ] && echo '    listen [::]:80;' )
    server_name $FQDN;
    root $DOCROOT;
    index index.html;
    gzip on;
    gzip_types text/css application/javascript application/json;
    location = /index.html { add_header Cache-Control "no-cache"; }
    location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
    location / { try_files \$uri \$uri/ =404; }
}
NGX
      [ -d /etc/nginx/sites-enabled ] && ln -sf "$NCONF" /etc/nginx/sites-enabled/
    fi
    nginx -t >/dev/null 2>&1 || die "Konfiguracja nginx ma błąd (nginx -t). Nic nie przeładowano."
    systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx
  else
    ACONF=/etc/apache2/sites-available/$FQDN.conf
    if [ ! -f "$ACONF" ]; then
      cat > "$ACONF" <<APC
# Moje miasto (gra) – założone przez tools/serwer-instalacja.sh
<VirtualHost *:80>
    ServerName $FQDN
    DocumentRoot $DOCROOT
    <Directory $DOCROOT>
        Require all granted
        Options -Indexes
    </Directory>
</VirtualHost>
APC
      a2ensite "$FQDN" >/dev/null
    fi
    apache2ctl configtest >/dev/null 2>&1 || die "Konfiguracja Apache ma błąd (apache2ctl configtest). Nic nie przeładowano."
    systemctl reload apache2
  fi
  if [ $DNS_OK = 1 ] && [ $KIND != caddy ]; then
    command -v certbot >/dev/null || apt-get install -y -qq certbot "python3-certbot-$KIND" >/dev/null
    if certbot --"$KIND" -d "$FQDN" --non-interactive --agree-tos --register-unsafely-without-email --redirect >/dev/null 2>&1; then echo "Certyfikat HTTPS: ok"
    else warn "Certyfikat nie wyszedł (certbot). Spróbuj ponownie za kilka minut, uruchamiając to samo polecenie."; fi
  fi
fi
echo "Katalog strony: $DOCROOT"

say "4/5 Automatyczne aktualizacje (co 2 minuty z GitHub, gałąź 'serwer')"
printf 'DOCROOT=%q\nOWNER=%q\nREPO=%q\nSRC=%q\n' "$DOCROOT" "$OWNER" "$REPO" "$SRC" > "$CONF"
cat > "$UPD" <<'UPDATE'
#!/usr/bin/env bash
# Pobiera najnowszą wersję gry z GitHub (gałąź "serwer") i kopiuje ją do katalogu strony. --force: kopiuje zawsze.
set -euo pipefail
. /etc/moje-miasto.conf
exec 9>/run/moje-miasto.lock; flock -n 9 || exit 0
if [ ! -d "$SRC/.git" ]; then
  git ls-remote --exit-code --heads "$REPO" serwer >/dev/null 2>&1 || { echo "$(date '+%F %T') gałąź 'serwer' jeszcze nie istnieje (GitHub jej nie zbudował)"; exit 0; }
  git clone -q --depth 1 -b serwer "$REPO" "$SRC"
else
  cd "$SRC"; old=$(git rev-parse HEAD)
  git fetch -q --depth 1 origin serwer; new=$(git rev-parse FETCH_HEAD)
  if [ "$old" = "$new" ] && [ "${1:-}" != --force ]; then exit 0; fi
  git reset -q --hard FETCH_HEAD; git reflog expire --expire=now --all; git gc -q --prune=now
fi
# zabezpieczenie: pierwszy raz tylko do nowego (prawie pustego) katalogu strony
if [ ! -f "$DOCROOT/.moje-miasto" ]; then
  n=$(ls -A "$DOCROOT" | wc -l)
  [ "$n" -le 10 ] || { echo "$(date '+%F %T') $DOCROOT zawiera $n plików innej strony – nie nadpisuję"; exit 1; }
  touch "$DOCROOT/.moje-miasto"
fi
rsync -r --delete --chmod=D755,F644 --exclude .git --exclude .moje-miasto --exclude .well-known "$SRC/" "$DOCROOT/"
[ -n "$OWNER" ] && chown -R "$OWNER" "$DOCROOT" || true
echo "$(date '+%F %T') wgrano: $(cat "$SRC/wersja.txt" 2>/dev/null)"
UPDATE
chmod 755 "$UPD"
echo '*/2 * * * * root /usr/local/bin/moje-miasto-aktualizuj >> /var/log/moje-miasto.log 2>&1' > /etc/cron.d/moje-miasto
chmod 644 /etc/cron.d/moje-miasto
echo "ok (dziennik: /var/log/moje-miasto.log)"

say "5/5 Pierwsze pobranie gry"
"$UPD" --force | tee -a /var/log/moje-miasto.log || warn "Pierwsze pobranie nie wyszło – zobacz komunikat wyżej."

say "Gotowe"
if [ $DNS_OK = 1 ]; then echo "Gra: https://$FQDN  (po zmianach w kodzie odśwież stronę: Ctrl+F5)"
else echo "Po dodaniu rekordu DNS (A: $SUB -> $MYIP) uruchom to polecenie jeszcze raz; potem gra: https://$FQDN"; fi
