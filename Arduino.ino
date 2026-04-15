#include <Wire.h>
#include <Adafruit_CCS811.h>
#include <PMS.h>
#include <WiFiEspAT.h>

// Sensör Nesneleri
Adafruit_CCS811 ccs;
PMS pms(Serial1); // PMS5003 -> Serial1 (pin 18/19)
PMS::DATA data;

// Wi-Fi Ayarları
char ssid[] = "ERDEMLER ERKEK YURDU";
char pass[] = "Yurt--2017";

// Pin Tanımlamaları
#define CCS_WAK_PIN 8
#define PMS_SET_PIN 7

// WebSocket Sunucu Bilgileri
#define WS_HOST "192.168.0.99"
#define WS_PORT 81

WiFiClient client;

// Sensor değerleri (global, loop içinde güncellenir)
int   co2  = 0;
int   voc  = 0;
int   pm25 = 0;
int   pm10 = 0;
bool  ccsOk = false;
bool  pmsOk = false;

unsigned long sonGonderimZamani = 0;
#define GONDERIM_ARALIGI 2000  // ms

// ── WebSocket yardımcı fonksiyonları ─────────────────────────────

// RFC 6455 text frame, client->server maskelemesi ile gönderir
void wsSendText(const String& msg) {
  if (!client.connected()) return;

  uint8_t mask[4] = {0x37, 0xfa, 0x21, 0x3d};
  int len = msg.length();

  client.write((uint8_t)0x81);                    // FIN + text opcode
  if (len < 126) {
    client.write((uint8_t)(0x80 | len));          // MASK=1, 7-bit uzunluk
  } else {
    client.write((uint8_t)(0x80 | 126));          // MASK=1, 16-bit uzunluk
    client.write((uint8_t)(len >> 8));
    client.write((uint8_t)(len & 0xFF));
  }
  client.write(mask, 4);
  for (int i = 0; i < len; i++) {
    client.write((uint8_t)(msg[i] ^ mask[i % 4]));
  }
}

// HTTP Upgrade handshake'i gerçekleştirir
bool wsHandshake() {
  client.print("GET / HTTP/1.1\r\n");
  client.print("Host: " WS_HOST ":" + String(WS_PORT) + "\r\n");
  client.print("Upgrade: websocket\r\n");
  client.print("Connection: Upgrade\r\n");
  client.print("Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n");
  client.print("Sec-WebSocket-Version: 13\r\n");
  client.print("\r\n");

  // Tüm yanıt header'larını oku
  String response = "";
  unsigned long t = millis();
  while (millis() - t < 5000) {
    while (client.available()) {
      response += (char)client.read();
      t = millis();
    }
    if (response.indexOf("\r\n\r\n") >= 0) break;
  }
  return response.indexOf("101") >= 0;
}

// WebSocket bağlantısını kurar (TCP + handshake)
bool wsConnect() {
  Serial.print("WebSocket baglaniliyor " WS_HOST ":" + String(WS_PORT) + " ...");
  if (!client.connect(WS_HOST, WS_PORT)) {
    Serial.println(" TCP hatasi!");
    return false;
  }
  if (!wsHandshake()) {
    Serial.println(" Handshake hatasi!");
    client.stop();
    return false;
  }
  Serial.println(" Baglandi!");
  return true;
}

// ── Setup ────────────────────────────────────────────────────────

void setup() {
  Serial.begin(9600);
  Serial1.begin(9600);
  Serial2.begin(115200);

  Serial.println("Sistem Baslatiliyor...");
  Serial.println("-----------------------------------------");

  // Sensörler
  pinMode(CCS_WAK_PIN, OUTPUT);
  digitalWrite(CCS_WAK_PIN, LOW);
  pinMode(PMS_SET_PIN, OUTPUT);
  digitalWrite(PMS_SET_PIN, HIGH);
  delay(1000);

  if (!ccs.begin()) {
    Serial.println("UYARI: CCS811 bulunamadi!");
  }

  // ESP8266 boot
  Serial.println("ESP8266 baslatiliyor...");
  Serial2.println("AT+RST");
  String bootTampon = "";
  unsigned long t = millis();
  while (millis() - t < 8000) {
    while (Serial2.available()) {
      bootTampon += (char)Serial2.read();
      if (bootTampon.length() > 500) bootTampon = bootTampon.substring(250);
    }
    if (bootTampon.indexOf("ready") >= 0) break;
  }
  while (Serial2.available()) Serial2.read();

  // WiFi bağlan
  WiFi.init(Serial2);
  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println("HATA: ESP8266 ile iletisim kurulamadi!");
    while (true);
  }

  Serial.print("WiFi baglaniliyor: ");
  Serial.println(ssid);
  WiFi.begin(ssid, pass);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi baglandi! IP: ");
  Serial.println(WiFi.localIP());

  // WebSocket bağlan
  while (!wsConnect()) {
    Serial.println("WebSocket yeniden deneniyor (5sn)...");
    delay(5000);
  }

  Serial.println("-----------------------------------------");
}

// ── Loop ─────────────────────────────────────────────────────────

void loop() {
  // CCS811 oku
  if (ccs.available() && !ccs.readData()) {
    co2  = ccs.geteCO2();
    voc  = ccs.getTVOC();
    ccsOk = true;
  }

  // PMS5003 oku
  if (pms.readUntil(data, 100)) {
    pm25 = data.PM_AE_UG_2_5;
    pm10 = data.PM_AE_UG_10_0;
    pmsOk = true;
  }

  // Her GONDERIM_ARALIGI ms'de bir gönder
  if (millis() - sonGonderimZamani >= GONDERIM_ARALIGI) {
    sonGonderimZamani = millis();

    // Bağlantı kontrolü ve yeniden bağlanma
    if (!client.connected()) {
      Serial.println("Baglanti koptu, yeniden baglaniliyor...");
      client.stop();
      while (!wsConnect()) {
        delay(3000);
      }
    }

    // JSON paketi oluştur
    String json = "{";
    json += "\"co2\":"  + String(co2)  + ",";
    json += "\"voc\":"  + String(voc)  + ",";
    json += "\"pm25\":" + String(pm25) + ",";
    json += "\"pm10\":" + String(pm10);
    json += "}";

    wsSendText(json);

    // Serial monitor'e de yaz
    Serial.println(json);
  }
}
