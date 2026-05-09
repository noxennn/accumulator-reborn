# Accumulator Reborn

Arduino tabanli bir hava kalitesi izleme sistemi. ESP8266 uzerinden WebSocket ile veri gonderen Arduino Mega, FastAPI tabanli bir backend ve React + Vite frontend'inden olusur.

## Mimari

```
+------------+  WebSocket  +--------------+  WebSocket  +------------+
|  Arduino   | ----------> |   Backend    | ----------> |  Frontend  |
|   Mega +   |   /ws       |   FastAPI    |   /ws/live  |   React    |
|  ESP8266   |             |   + MySQL    |             |   + Vite   |
+------------+             +--------------+             +------------+
   CCS811                                                   Tarayici
   PMS5003
```

- **Arduino** (`arduino/`): CO2, VOC, PM2.5, PM10 sensorlerini okur, ESP8266 uzerinden backend'e WebSocket ile gonderir.
- **Backend** (`backend/`): FastAPI; veriyi MySQL'e yazar, frontend'e canli yayinlar, esik asiminda e-posta uyarisi gonderir, JWT ile auth saglar.
- **Frontend** (`frontend/`): React + Vite + Tailwind; canli dashboard, analiz, watch sayfasi ve ayarlar.

## Gereksinimler

| Bilesen   | Surum                                 |
| --------- | ------------------------------------- |
| Python    | 3.10+                                 |
| Node.js   | 18+ (npm 9+)                          |
| MySQL     | 8.0+ (veya MariaDB 10.5+)             |
| Arduino   | Arduino IDE 1.8+ veya Arduino CLI     |
| Donanim   | Arduino Mega 2560 + ESP8266 + CCS811 + PMS5003 (opsiyonel) |

## Hizli Baslangic

```bash
# 1. Repo'yu klonla
git clone https://github.com/burakpekisik/accumulator-reborn.git
cd accumulator-reborn

# 2. Backend (yeni bir terminalde)
cd backend
python -m venv .venv
.venv\Scripts\activate         # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
cp .env.example .env            # .env dosyasini duzenle (asagiya bak)
python main.py                  # http://localhost:8000

# 3. Frontend (baska bir terminalde)
cd frontend
npm install
cp .env.example .env            # gerekirse VITE_API_URL'i degistir
npm run dev                     # http://localhost:5173
```

---

## 1) Backend Kurulumu

### MySQL hazirla

```sql
CREATE DATABASE accumulator CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'accumulator'@'localhost' IDENTIFIED BY 'guclu-bir-sifre';
GRANT ALL PRIVILEGES ON accumulator.* TO 'accumulator'@'localhost';
FLUSH PRIVILEGES;
```

> Tablolar uygulama ilk calistiginda `models.Base.metadata.create_all` ile otomatik olusturulur - manuel migration gerekmiyor.

### Sanal ortam ve bagimliliklar

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate         # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -r requirements.txt
```

### `.env` dosyasi

`backend/.env.example` dosyasini `backend/.env` olarak kopyala ve asagidaki degiskenleri doldur:

| Degisken        | Aciklama                                                   |
| --------------- | ---------------------------------------------------------- |
| `DATABASE_URL`  | `mysql+pymysql://kullanici:sifre@host:3306/accumulator`    |
| `SECRET_KEY`    | JWT imzalama anahtari (uzun, rastgele)                     |
| `MAIL_USERNAME` | SMTP kullanici adi                                         |
| `MAIL_PASSWORD` | SMTP sifre / app password                                  |
| `MAIL_FROM`     | Gonderen e-posta adresi                                    |
| `MAIL_PORT`     | SMTP portu (Gmail icin `587`)                              |
| `MAIL_SERVER`   | SMTP sunucusu (Gmail icin `smtp.gmail.com`)                |

Guclu bir `SECRET_KEY` uretmek icin:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

> **Gmail kullaniyorsan**: normal sifre degil, [App Password](https://myaccount.google.com/apppasswords) uret.

### Calistir

```bash
python main.py
# veya:
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

- API: `http://localhost:8000`
- Swagger UI: `http://localhost:8000/docs`
- WebSocket (Arduino -> backend): `ws://localhost:8000/ws`
- WebSocket (frontend canli yayin): `ws://localhost:8000/ws/live`

---

## 2) Frontend Kurulumu

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

`.env`:

```
VITE_API_URL=http://localhost:8000
# VITE_WS_URL=ws://localhost:8000/ws/live   # gerekirse override et
```

| Komut             | Aciklama                                |
| ----------------- | --------------------------------------- |
| `npm run dev`     | Gelistirme sunucusu (`localhost:5173`)  |
| `npm run build`   | Uretim build'i (`dist/`)                |
| `npm run preview` | Build ciktisini onizle                  |
| `npm run lint`    | ESLint                                  |

Tarayicidan `http://localhost:5173` ac -> kayit ol -> giris yap.

---

## 3) Arduino Kurulumu

### Donanim baglantilari

| Bilesen          | Pin / Baglanti                               |
| ---------------- | -------------------------------------------- |
| CCS811           | I2C (SDA/SCL) + WAK -> pin 8                 |
| PMS5003          | `Serial1` (pin 18 TX / 19 RX) + SET -> pin 7 |
| ESP8266 (AT)     | `Serial2` (pin 16 TX / 17 RX), RST -> pin 4  |

### Arduino IDE'ye eklenecek kutuphaneler

Library Manager uzerinden:

- **Adafruit CCS811** (Adafruit)
- **PMS Library** (Mariusz Kacki / fu-hsi)
- **WiFiEspAT** (Juraj Andrassy)

`Wire.h`, `EEPROM.h`, `avr/wdt.h` Arduino cekirdegiyle gelir.

### Yapilandirma

`arduino/Arduino.ino` icinde asagidaki sabitleri **kendi ortamina gore** guncelle:

```cpp
char ssid[]         = "WIFI_SSID";
char pass[]         = "WIFI_PASSWORD";
char ssidFallback[] = "WIFI_SSID_YEDEK";
char passFallback[] = "WIFI_PASSWORD_YEDEK";

#define WS_HOST "air.aliburakpekisik.com"   // <- kendi backend host'una cevir
#define WS_PORT 80                          // <- localhost icin 8000
```

> Yerel gelistirme icin `WS_HOST`'u backend'in bulundugu makinenin IP'si (orn. `192.168.1.50`) ve `WS_PORT`'u `8000` yap. ESP8266 ile ayni Wi-Fi aginda olmali.

### Yukleme

1. Arduino IDE -> **Tools -> Board -> Arduino Mega 2560**
2. `arduino/Arduino.ino` dosyasini ac -> **Upload**
3. (Ilk kez) ESP8266'nin AT firmware'i ile calistigini dogrulamak icin `arduino/ESP8266_Test/ESP8266_Test.ino` ile test et.

---

## Proje Yapisi

```
.
+-- arduino/
|   +-- Arduino.ino                 # Ana sensor + WebSocket istemcisi
|   +-- ESP8266_Test/               # ESP8266 AT komutlari test sketch'i
+-- backend/
|   +-- main.py                     # FastAPI uygulamasi, WS endpoint'leri
|   +-- auth.py                     # JWT, parola hash
|   +-- database.py                 # SQLAlchemy engine
|   +-- models.py                   # ORM modelleri
|   +-- schemas.py                  # Pydantic semalari
|   +-- requirements.txt
|   +-- rf_model.pkl                # Onceden egitilmis RandomForest modeli
|   +-- templates/email_alert.html  # E-posta sablonu
|   +-- utils/email.py              # SMTP gonderici
+-- frontend/
|   +-- src/
|   |   +-- pages/                  # Dashboard, Analytics, Watch, Settings, Login, ...
|   |   +-- components/             # Indicator'lar, Sidebar, ThemeToggle, ...
|   |   +-- hooks/                  # useAuth, useWebSocketData, useDailyStats, ...
|   |   +-- lib/                    # api.ts, sensorApi.ts, analyticsApi.ts
|   |   +-- i18n/                   # tr / en lokalizasyon
|   +-- package.json
|   +-- vite.config.ts
+-- docs/
    +-- plan.md
```

## Sik Karsilasilan Sorunlar

- **`int(os.getenv("MAIL_PORT"))` hatasi**: `.env` dosyanda `MAIL_PORT` tanimli degil. `.env.example`'daki tum `MAIL_*` degiskenlerini doldur.
- **MySQL baglanti hatasi**: `DATABASE_URL` dogru mu, MySQL servisi calisiyor mu, kullanici yetkilendirmeleri verildi mi kontrol et.
- **Frontend WebSocket baglanmiyor**: Backend'in `0.0.0.0:8000`'de calistigindan ve `VITE_API_URL`'in dogru oldugundan emin ol. Farkli host/port'ta calistiriyorsan `VITE_WS_URL`'i elle ayarla.
- **Arduino WS'e baglanmiyor**: `WS_HOST` ve `WS_PORT` dogru mu, ESP8266 firmware'i `AT` cevabi veriyor mu (`ESP8266_Test.ino` ile dene), Arduino ve backend ayni agda mi kontrol et.


