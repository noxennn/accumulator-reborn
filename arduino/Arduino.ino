#include <Wire.h>
#include <Adafruit_CCS811.h>
#include <PMS.h>
#include <WiFiEspAT.h>
#include <EEPROM.h>
#include <avr/wdt.h>

// Sensör Nesneleri
Adafruit_CCS811 ccs;
PMS pms(Serial1); // PMS5003 -> Serial1 (pin 18/19)
PMS::DATA data;

// Wi-Fi Ayarları
char ssid[]         = "ERDEMLER ERKEK YURDU";
char pass[]         = "Yurt--2017";
char ssidFallback[] = "ABP";
char passFallback[] = "deneme123";

// Pin Tanımlamaları
#define CCS_WAK_PIN 8
#define PMS_SET_PIN 7
#define ESP_RST_PIN  4   // Arduino pin 4 -> ESP8266 RST pini

// WebSocket Sunucu Bilgileri
#define WS_HOST "air.aliburakpekisik.com"
#define WS_PORT 80

WiFiClient client;

// Sensor değerleri (global, loop içinde güncellenir)
int   co2  = 0;
int   voc  = 0;
int   pm25 = 0;
int   pm10 = 0;
bool  ccsOk   = false;
bool  ccsFresh = false;
bool  pmsOk   = false;

// Backend tarafindaki invalid/log akisini beslemek icin son gecersiz ornek.
bool invalidSamplePending = false;
int  invalidCo2 = 0;
int  invalidVoc = 0;
int  invalidPm25 = 0;
int  invalidPm10 = 0;

unsigned long sonGonderimZamani = 0;
unsigned long lastDataSent      = 0;
#define GONDERIM_ARALIGI 2000  // ms
#define MAX_SILENT_MS (5UL * 60UL * 1000UL)

// PMS sensör ölü-mu tespiti: ısınma bittikten 3 dk sonra hâlâ veri yoksa ölü kabul et
#define PMS_FAIL_TIMEOUT_MS (3UL * 60UL * 1000UL)
unsigned long pmsWarmupEndTime = 0;

// ══════════════════════════════════════════════════════════════════
//  CCS811 Enterprise-Grade Filtreleme Sistemi
// ══════════════════════════════════════════════════════════════════

#define CCS_WARMUP_MS   (20UL * 60UL * 1000UL)  // 20 dakika
unsigned long ccsStartTime = 0;

// Soft-reset'te SRAM içeriği korunur; güç kesintisinde rastgele olur.
#define WARMUP_MAGIC_VAL 0xCAFEBABEUL
volatile uint32_t warmupMagic __attribute__((section(".noinit")));
volatile bool     warmupDone  __attribute__((section(".noinit")));

// ── Baseline kaydet/geri yükle ──────────────────────────────────
#define EEPROM_BASELINE_ADDR   0
#define EEPROM_MAGIC           0xA5
#define BASELINE_SAVE_INTERVAL (60UL * 60UL * 1000UL)
unsigned long lastBaselineSave = 0;

void saveBaseline() {
  uint16_t baseline = ccs.getBaseline();
  EEPROM.update(EEPROM_BASELINE_ADDR,     baseline & 0xFF);
  EEPROM.update(EEPROM_BASELINE_ADDR + 1, (baseline >> 8) & 0xFF);
  EEPROM.update(EEPROM_BASELINE_ADDR + 2, EEPROM_MAGIC);
  Serial.print(F("Baseline kaydedildi: 0x"));
  Serial.println(baseline, HEX);
}

bool restoreBaseline() {
  if (EEPROM.read(EEPROM_BASELINE_ADDR + 2) != EEPROM_MAGIC) return false;
  uint16_t baseline = EEPROM.read(EEPROM_BASELINE_ADDR) |
                      (EEPROM.read(EEPROM_BASELINE_ADDR + 1) << 8);
  ccs.setBaseline(baseline);
  Serial.print(F("Baseline geri yuklendi: 0x"));
  Serial.println(baseline, HEX);
  return true;
}

// ── Zorla sistem yeniden başlatma ────────────────────────────────
void forceReset() {
  Serial.println(F("[SYS] Sistem zorla yeniden baslatiliyor..."));
  Serial.flush();
  wdt_enable(WDTO_15MS);
  while (1);
}

// ── ESP8266 "ready" bekleme (3 yerde aynı döngü vardı) ──────────
// timeout_ms: maksimum bekleme süresi; true = "ready" alındı
bool waitForESPReady(unsigned long timeout_ms) {
  const char READY[] = "ready";
  uint8_t mi = 0;
  unsigned long t = millis();
  while (millis() - t < timeout_ms) {
    wdt_reset();
    while (Serial2.available()) {
      char c = (char)Serial2.read();
      mi = (c == READY[mi]) ? mi + 1 : (c == READY[0] ? 1 : 0);
      if (mi == 5) return true;
    }
  }
  return false;
}

// ── Datasheet aralık kontrolü ────────────────────────────────────
#define CO2_MIN   400
#define CO2_MAX   8192
#define VOC_MIN   0
#define VOC_MAX   1187

bool ccsRangeValid(int rawCo2, int rawVoc) {
  return (rawCo2 >= CO2_MIN && rawCo2 <= CO2_MAX &&
          rawVoc >= VOC_MIN && rawVoc <= VOC_MAX);
}

// ── EMA filtresi ─────────────────────────────────────────────────
#define EMA_ALPHA  0.3f

float emaCo2 = -1;
float emaVoc = -1;

// ── Rate-of-Change limiter ───────────────────────────────────────
#define CO2_MAX_RATE  80    // ppm/okuma (2 sn aralıkla)
#define VOC_MAX_RATE  30    // ppb/okuma

int lastValidCo2 = -1;
int lastValidVoc = -1;

// ── Consecutive-spike sayacı ─────────────────────────────────────
#define MAX_CONSECUTIVE_REJECTS  5
uint8_t consecutiveRejects = 0;

// ── Bozuk baseline tespiti ───────────────────────────────────────
#define MAX_ARALIK_DISI_RESETS  30
uint8_t  aralikDisiSayaci           = 0;
bool     baselineOtomatikSifirlandi = false;
uint16_t gecerliOkumaSayaci         = 0;

// ── Ana filtre fonksiyonu ────────────────────────────────────────
bool ccsFilter(int rawCo2, int rawVoc) {

  // Warm-up devam ediyorsa hiçbir değer gönderme (dakikada bir logla)
  if (millis() - ccsStartTime < CCS_WARMUP_MS) {
    static unsigned long lastWarmupLog = 0;
    if (millis() - lastWarmupLog >= 60000) {
      lastWarmupLog = millis();
      unsigned long kalanMs = CCS_WARMUP_MS - (millis() - ccsStartTime);
      unsigned long kalanDk = kalanMs / 60000;
      unsigned long kalanSn = (kalanMs % 60000) / 1000;
      Serial.print(F("[CCS] Isinma suresi, kalan: "));
      Serial.print(kalanDk); Serial.print(F("dk ")); Serial.print(kalanSn); Serial.println(F("sn"));
    }
    return false;
  }

  if (!warmupDone) {
    warmupDone = true;
    warmupMagic = WARMUP_MAGIC_VAL;
    Serial.println(F("[CCS] Isinma tamamlandi, olcumler basliyor."));
  }

  if (!ccsRangeValid(rawCo2, rawVoc)) {
    Serial.print(F("[CCS] Aralik disi: CO2="));
    Serial.print(rawCo2); Serial.print(F(" VOC=")); Serial.println(rawVoc);
    invalidCo2 = rawCo2;
    invalidVoc = rawVoc;
    invalidPm25 = pm25;
    invalidPm10 = pm10;
    invalidSamplePending = true;
    wsSendRawLog("[CCS] Aralik disi olcum algilandi");
    aralikDisiSayaci++;
    if (!baselineOtomatikSifirlandi && aralikDisiSayaci >= MAX_ARALIK_DISI_RESETS) {
      Serial.println(F("[CCS] UYARI: Surekli aralik disi okuma - EEPROM baseline bozuk olabilir."));
      Serial.println(F("[CCS] EEPROM baseline silindi. Sistem yeniden baslatiliyor..."));
      wsSendRawLog("[CCS] EEPROM baseline bozuk olabilir, sistem resetlenecek");
      wsSendRestartWarningEvent("invalid_data_threshold");
      EEPROM.update(EEPROM_BASELINE_ADDR + 2, 0x00);
      forceReset();
    }
    return false;
  }
  aralikDisiSayaci = 0;
  // Taşmayı önle: uint16_t max = 65535; baseline koşulu >= 100 olduğundan
  // bir kez geçince değer artmaya devam etmez, baseline her saat kaydedilir
  if (gecerliOkumaSayaci < 65000) gecerliOkumaSayaci++;

  if (rawCo2 <= 415 && rawVoc == 0) {
    Serial.println(F("[CCS] Reset degeri tespit edildi, atlandi."));
    return false;
  }

  if (lastValidCo2 >= 0) {
    int deltaCo2 = abs(rawCo2 - lastValidCo2);
    int deltaVoc = abs(rawVoc - lastValidVoc);

    if (deltaCo2 > CO2_MAX_RATE || deltaVoc > VOC_MAX_RATE) {
      consecutiveRejects++;
      Serial.print(F("[CCS] Ani degisim atildi: dCO2="));
      Serial.print(deltaCo2); Serial.print(F(" dVOC=")); Serial.print(deltaVoc);
      Serial.print(F(" (ardisik:")); Serial.print(consecutiveRejects); Serial.println(')');

      if (consecutiveRejects >= MAX_CONSECUTIVE_REJECTS) {
        Serial.println(F("[CCS] Ardisik red limiti asildi, EMA sifirlaniyor."));
        emaCo2 = rawCo2;
        emaVoc = rawVoc;
        lastValidCo2 = rawCo2;
        lastValidVoc = rawVoc;
        consecutiveRejects = 0;
        co2 = rawCo2;
        voc = rawVoc;
        return true;
      }
      return false;
    }
  }

  consecutiveRejects = 0;

  if (emaCo2 < 0) {
    emaCo2 = rawCo2;
    emaVoc = rawVoc;
  } else {
    emaCo2 = EMA_ALPHA * rawCo2 + (1.0f - EMA_ALPHA) * emaCo2;
    emaVoc = EMA_ALPHA * rawVoc + (1.0f - EMA_ALPHA) * emaVoc;
  }

  lastValidCo2 = rawCo2;
  lastValidVoc = rawVoc;
  co2 = (int)(emaCo2 + 0.5f);
  voc = (int)(emaVoc + 0.5f);
  return true;
}

// ── WebSocket yardımcı fonksiyonları ─────────────────────────────

void wsSendText(const char* msg) {
  if (!client.connected()) return;

  uint8_t mask[4] = {0x37, 0xfa, 0x21, 0x3d};
  int len = strlen(msg);

  client.write((uint8_t)0x81);
  if (len < 126) {
    client.write((uint8_t)(0x80 | len));
  } else {
    client.write((uint8_t)(0x80 | 126));
    client.write((uint8_t)(len >> 8));
    client.write((uint8_t)(len & 0xFF));
  }
  client.write(mask, 4);
  for (int i = 0; i < len; i++) {
    client.write((uint8_t)(msg[i] ^ mask[i % 4]));
  }
}

void wsSendRawLog(const char* msg) {
  if (!client.connected()) return;
  wsSendText(msg);
}

void wsSendRestartWarningEvent(const char* reason) {
  if (!client.connected()) return;
  char payload[192];
  snprintf(payload, sizeof(payload),
           "{\"type\":\"event\",\"event_type\":\"restart_warning\",\"source\":\"arduino\",\"reason\":\"%s\"}",
           reason);
  wsSendText(payload);
  client.flush();
  delay(120);
}

bool wsHandshake() {
  // Bu stringler client'e gönderildiği için F() kullanılmıyor —
  // WiFiEspAT'ın print(__FlashStringHelper*) davranışı kütüphaneye bağlı
  client.print("GET /ws HTTP/1.1\r\n");
  client.print("Host: " WS_HOST ":80\r\n");
  client.print("Upgrade: websocket\r\n");
  client.print("Connection: Upgrade\r\n");
  client.print("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n");
  client.print("Sec-WebSocket-Version: 13\r\n");
  client.print("\r\n");

  // 160 byte: HTTP/1.1 101 yanıtı tipik olarak ~130 byte; 256'ya gerek yok (96 byte SRAM kazanımı)
  static char response[160];
  memset(response, 0, sizeof(response));
  uint16_t idx = 0;
  unsigned long tStart = millis();
  unsigned long tIdle  = millis();
  while (millis() - tStart < 7000 && millis() - tIdle < 3000) {
    wdt_reset();
    while (client.available()) {
      char c = (char)client.read();
      if (idx < sizeof(response) - 1) response[idx++] = c;
      tIdle = millis();
    }
    if (idx > 4 && strstr(response, "\r\n\r\n")) break;
  }
  return strstr(response, "101") != NULL;
}

bool wsConnect() {
  Serial.print(F("WebSocket baglaniliyor " WS_HOST ":80 ..."));
  if (!client.connect(WS_HOST, WS_PORT)) {
    Serial.println(F(" TCP hatasi!"));
    return false;
  }
  if (!wsHandshake()) {
    Serial.println(F(" Handshake hatasi!"));
    client.stop();
    return false;
  }
  Serial.println(F(" Baglandi!"));
  return true;
}

// Önce ana ağa, başarısız olursa yedek ağa bağlanmayı dener.
// WiFi AP bağlantısı kurulduktan sonra gerçek internet erişimi de test edilir;
// AP'ye bağlı ama internetsiz ağlar (captive portal, kötü yurt ağı vb.) fallback'e yönlendirir.
bool wifiBaglan() {
  Serial.print(F("WiFi baglaniliyor (ana ag): "));
  Serial.println(ssid);
  // WiFi.begin() kütüphane içinde AT+CWJAP bekler; bu süre WDT zaman aşımını (8sn)
  // geçebilir. WDT'yi geçici devre dışı bırakıp kendi döngümüzde yönetiyoruz.
  wdt_disable();
  WiFi.begin(ssid, pass);
  wdt_reset(); wdt_enable(WDTO_8S);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    wdt_reset();
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    // AP bağlantısı var; gerçek internet erişimini test et.
    // client.connect() WDT (8sn) süresini aşabileceğinden WiFi.begin() gibi devre dışı bırakıyoruz.
    Serial.println(F("Internet erisimi kontrol ediliyor..."));
    wdt_disable();
    bool internetOk = client.connect(WS_HOST, WS_PORT);
    wdt_reset(); wdt_enable(WDTO_8S);
    if (internetOk) {
      client.stop();
      Serial.println(F("Internet erisimi OK."));
      return true;
    }
    Serial.println(F("WiFi baglandi ama internet erisimi yok, yedek aga geciliyor."));
    WiFi.disconnect();
    delay(500);
  } else {
    Serial.print(F("Ana ag basarisiz. Yedek ag deneniyor: "));
  }

  Serial.println(ssidFallback);
  wdt_disable();
  WiFi.begin(ssidFallback, passFallback);
  wdt_reset(); wdt_enable(WDTO_8S);
  t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    wdt_reset();
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  return (WiFi.status() == WL_CONNECTED);
}

// ESP8266 donanım reset (RST pinini anlık LOW yapar)
void espHardReset() {
  Serial.println(F("[ESP] Donanim reset uygulanıyor (RST pini)..."));
  client.stop();
  WiFi.disconnect();
  delay(200);
  digitalWrite(ESP_RST_PIN, LOW);
  delay(100);
  digitalWrite(ESP_RST_PIN, HIGH);
  waitForESPReady(10000);
  delay(2000);
  while (Serial2.available()) Serial2.read();
  // wdt_disable() YOK — WiFi.init() donkarsa WDT atar → reboot
  wdt_reset();
  WiFi.init(Serial2);
  wdt_reset();
  Serial.println(F("[ESP] Donanim reset tamamlandi."));
}

// WiFi + WebSocket tam yeniden bağlanma (ESP reset dahil)
void tamYenidenBaglan() {
  static uint8_t basarisizSayaci = 0;
  static uint8_t totalEspResets  = 0;  // başarılı bağlantıda sıfırlanır

  if (basarisizSayaci >= 3) {
    totalEspResets++;
    Serial.print(F("[ESP] Toplam ESP reset sayisi: "));
    Serial.println(totalEspResets);

    if (totalEspResets >= 5) {
      Serial.println(F("[SYS] Cok fazla ESP reset, tam sistem yeniden baslatiliyor..."));
      forceReset();
    }

    Serial.println(F("ESP8266 yeniden baslatiliyor (AT+RST)..."));
    client.stop();
    WiFi.disconnect();
    wdt_reset();
    delay(500);

    Serial2.println("AT+RST");
    bool atRstOk = waitForESPReady(8000);
    while (Serial2.available()) Serial2.read();

    if (atRstOk) {
      Serial.println(F("[ESP] AT+RST basarili."));
      delay(2000);
      while (Serial2.available()) Serial2.read();
      // wdt_disable() YOK — WiFi.init() donkarsa WDT atar → reboot
      wdt_reset();
      WiFi.init(Serial2);
      wdt_reset();
    } else {
      Serial.println(F("[ESP] AT+RST cevap vermedi, donanim reset uygulanıyor..."));
      espHardReset();
    }
    basarisizSayaci = 0;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("WiFi yeniden baglaniliyor..."));
    wdt_disable();
    WiFi.disconnect();
    wdt_reset(); wdt_enable(WDTO_8S);
    delay(500);
    if (!wifiBaglan()) {
      Serial.println(F("WiFi baglantisi kurulamadi, tekrar denenecek."));
      basarisizSayaci++;
      return;
    }
    Serial.print(F("WiFi baglandi! IP: "));
    Serial.println(WiFi.localIP());
  }

  client.stop();
  wdt_reset();
  delay(500);
  if (!wsConnect()) {
    basarisizSayaci++;
    Serial.print(F("Basarisiz deneme: "));
    Serial.print(basarisizSayaci);
    Serial.println(F("/3"));
    wdt_reset();
    delay(3000);
  } else {
    basarisizSayaci = 0;
    totalEspResets  = 0;
  }
}

// Gelen WebSocket frame'lerini işler, ping gelirse pong döner
void wsHandleIncoming() {
  if (!client.available()) return;

  uint8_t b0 = client.read();
  if (!client.available()) return;
  uint8_t b1 = client.read();

  uint8_t  opcode     = b0 & 0x0F;
  uint8_t  masked     = (b1 & 0x80) >> 7;
  uint16_t payloadLen = b1 & 0x7F;  // uint16_t: AVR'de uint64_t yazılım-emülasyonlu, gereksiz yavaş

  if (payloadLen == 126) {
    unsigned long _t = millis();
    while (client.available() < 2) {
      wdt_reset();
      if (millis() - _t > 2000) { client.stop(); return; }
    }
    uint8_t ext[2];
    client.readBytes(ext, 2);
    payloadLen = ((uint16_t)ext[0] << 8) | ext[1];
  } else if (payloadLen == 127) {
    return;
  }

  uint8_t mask[4] = {0};
  if (masked) {
    unsigned long _t = millis();
    while (client.available() < 4) {
      wdt_reset();
      if (millis() - _t > 2000) { client.stop(); return; }
    }
    client.readBytes(mask, 4);
  }

  uint8_t payload[125];
  uint8_t readLen = (uint8_t)min((uint16_t)125, payloadLen);
  for (uint8_t i = 0; i < readLen; i++) {
    uint8_t raw = client.available() ? client.read() : 0;
    payload[i] = masked ? (raw ^ mask[i % 4]) : raw;
  }

  if (payloadLen > readLen) {
    unsigned long drainStart = millis();
    for (uint16_t i = readLen; i < payloadLen; i++) {
      while (!client.available()) {
        wdt_reset();
        if (millis() - drainStart > 3000) { client.stop(); return; }
      }
      client.read();
    }
  }

  if (opcode == 0x9) {
    uint8_t pongMask[4] = {0x4A, 0xC3, 0x7E, 0x21};
    client.write((uint8_t)0x8A);
    client.write((uint8_t)(0x80 | readLen));
    client.write(pongMask, 4);
    for (uint8_t i = 0; i < readLen; i++) {
      client.write((uint8_t)(payload[i] ^ pongMask[i % 4]));
    }
  } else if (opcode == 0x8) {
    client.stop();
  }
}


void setup() {
  MCUSR &= ~(1 << WDRF);
  wdt_disable();

  Serial.begin(9600);
  Serial1.begin(9600);
  Serial2.begin(115200);

  Serial.println(F("Sistem Baslatiliyor..."));
  Serial.println(F("-----------------------------------------"));

  pmsWarmupEndTime = 0;

  pinMode(ESP_RST_PIN, OUTPUT);
  digitalWrite(ESP_RST_PIN, HIGH);
  pinMode(CCS_WAK_PIN, OUTPUT);
  digitalWrite(CCS_WAK_PIN, LOW);
  pinMode(PMS_SET_PIN, OUTPUT);
  digitalWrite(PMS_SET_PIN, HIGH);
  delay(1000);

  if (!ccs.begin()) {
    Serial.println(F("UYARI: CCS811 bulunamadi!"));
  } else {
    if (restoreBaseline()) {
      Serial.println(F("CCS811 baseline EEPROM'dan yuklendi."));
    } else {
      Serial.println(F("CCS811 baseline bulunamadi, ilk kalibrasyonda kaydedilecek."));
    }
  }

  if (warmupMagic == WARMUP_MAGIC_VAL && warmupDone) {
    ccsStartTime = millis() - CCS_WARMUP_MS;
    Serial.println(F("[CCS] Soft-reset: sensor zaten isinmis, bekleme atlaniyor."));
  } else {
    warmupMagic = 0;
    warmupDone  = false;
    ccsStartTime = millis();
    Serial.println(F("[CCS] Guc verildi, 20dk isinma suresi basliyor."));
  }

  // ESP8266 boot — WDT buradan itibaren AÇIK; donma durumunda kurtarıcı
  Serial.println(F("ESP8266 baslatiliyor..."));
  wdt_reset();
  wdt_enable(WDTO_8S);

  Serial2.println("AT+RST");
  waitForESPReady(8000);
  while (Serial2.available()) Serial2.read();

  // "ready" sonrası ESP hâlâ boot mesajları gönderiyor; 2sn bekle
  wdt_reset();
  delay(2000);
  while (Serial2.available()) Serial2.read();

  // wdt_disable() YOK — WiFi.init() donkarsa WDT atar → clean reboot
  wdt_reset();
  WiFi.init(Serial2);
  wdt_reset();

  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println(F("HATA: ESP8266 ile iletisim kurulamadi, yeniden baslatiliyor..."));
    forceReset();
  }

  // WiFi bağlan — 5 başarısız denemeden sonra forceReset()
  {
    uint8_t retries = 0;
    while (!wifiBaglan()) {
      Serial.println(F("Her iki WiFi de basarisiz, yeniden deneniyor..."));
      if (++retries >= 5) {
        Serial.println(F("WiFi tamamen basarisiz, sistem yeniden baslatiliyor..."));
        forceReset();
      }
      wdt_reset();
      delay(3000);
    }
  }
  Serial.print(F("WiFi baglandi! IP: "));
  Serial.println(WiFi.localIP());

  // WebSocket bağlan — 10 başarısız denemeden sonra forceReset()
  {
    uint8_t retries = 0;
    while (!wsConnect()) {
      Serial.println(F("WebSocket yeniden deneniyor (3sn)..."));
      if (++retries >= 10) {
        Serial.println(F("WebSocket tamamen basarisiz, sistem yeniden baslatiliyor..."));
        forceReset();
      }
      wdt_reset();
      delay(3000);
    }
  }

  wdt_reset();
  Serial.println(F("-----------------------------------------"));
}

// ── Loop ─────────────────────────────────────────────────────────

void loop() {
  wdt_reset();

  // Gelen frame'leri işle — maksimum 1500ms; sunucu flood'larsa sensör okumayı engellemesin
  {
    unsigned long frameStart = millis();
    while (client.available() >= 2 && millis() - frameStart < 1500) {
      wdt_reset();
      wsHandleIncoming();
    }
  }

  // CCS811 oku — ardışık okuma hatalarında sensörü yeniden başlat
  {
    static uint8_t ccsReadErrors = 0;
    if (ccs.available()) {
      if (ccs.readData()) {
        if (++ccsReadErrors >= 20) {
          Serial.println(F("[CCS] Surekli okuma hatasi, sensor yeniden baslatiliyor..."));
          ccs.begin();
          ccsReadErrors = 0;
        }
      } else {
        ccsReadErrors = 0;
        int rawCo2 = ccs.geteCO2();
        int rawVoc = ccs.getTVOC();
        if (ccsFilter(rawCo2, rawVoc)) {
          ccsOk   = true;
          ccsFresh = true;
        } else {
          ccsFresh = false;
        }
      }
    }
  }

  // PMS5003 oku
  if (pms.readUntil(data, 20)) {
    pm25 = data.PM_AE_UG_2_5;
    pm10 = data.PM_AE_UG_10_0;
    pmsOk = true;
    pmsWarmupEndTime = 0;
  }

  // PMS sensör ölü-mü kontrolü: ısınma bittikten 3 dk boyunca hâlâ veri gelmediyse
  if (!pmsOk && millis() - ccsStartTime >= CCS_WARMUP_MS) {
    if (pmsWarmupEndTime == 0) {
      pmsWarmupEndTime = millis();
    } else if (millis() - pmsWarmupEndTime >= PMS_FAIL_TIMEOUT_MS) {
      Serial.println(F("[PMS] Sensor 3dk boyunca cevap vermedi, PM degerler sifir kabul ediliyor."));
      pm25 = 0;
      pm10 = 0;
      pmsOk = true;
    }
  }

  // Her GONDERIM_ARALIGI ms'de bir gönder
  if (millis() - sonGonderimZamani >= GONDERIM_ARALIGI) {
    sonGonderimZamani = millis();

    if (!client.connected()) {
      Serial.println(F("Baglanti koptu, yeniden baglaniliyor..."));
      tamYenidenBaglan();
      return;
    }

    if (invalidSamplePending) {
      char invalidJson[64];
      snprintf(invalidJson, sizeof(invalidJson), "{\"co2\":%d,\"voc\":%d,\"pm25\":%d,\"pm10\":%d}",
               invalidCo2, invalidVoc, invalidPm25, invalidPm10);
      wsSendText(invalidJson);
      Serial.print(F("[WS] Gecersiz ornek gonderildi: "));
      Serial.println(invalidJson);
      invalidSamplePending = false;
    }

    if (lastDataSent > 0 &&
        millis() - ccsStartTime >= CCS_WARMUP_MS &&
        millis() - lastDataSent  >= MAX_SILENT_MS) {
      Serial.println(F("[WD] 5dk boyunca veri gonderilmedi, baglanti sifirlaniyor..."));
      client.stop();
      tamYenidenBaglan();
      lastDataSent = millis();
      return;
    }

    if (!ccsOk || !pmsOk || !ccsFresh) {
      return;
    }

    char json[64];
    snprintf(json, sizeof(json), "{\"co2\":%d,\"voc\":%d,\"pm25\":%d,\"pm10\":%d}",
             co2, voc, pm25, pm10);

    wsSendText(json);
    lastDataSent = millis();
    ccsFresh = false;

    if (!client.connected()) {
      Serial.println(F("[WS] Gonderim sonrasi baglanti koptu!"));
      tamYenidenBaglan();
      return;
    }

    Serial.println(json);
  }

  // Periyodik baseline kaydetme (her 1 saatte)
  if (millis() - ccsStartTime >= CCS_WARMUP_MS &&
      millis() - lastBaselineSave >= BASELINE_SAVE_INTERVAL &&
      gecerliOkumaSayaci >= 100) {
    lastBaselineSave = millis();
    saveBaseline();
  }
}
