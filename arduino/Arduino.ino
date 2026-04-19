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
#define WS_PORT 8765

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

// WiFi + WebSocket tam yeniden bağlanma (ESP reset dahil)
void tamYenidenBaglan() {
  static uint8_t basarisizSayaci = 0;

  // 3 ardışık başarısız denemeden sonra ESP'yi tamamen sıfırla
  if (basarisizSayaci >= 3) {
    Serial.println("ESP8266 yeniden baslatiliyor (AT+RST)...");
    client.stop();
    WiFi.disconnect();
    delay(500);

    Serial2.println("AT+RST");
    String buf = "";
    unsigned long t = millis();
    while (millis() - t < 8000) {
      while (Serial2.available()) {
        buf += (char)Serial2.read();
        if (buf.length() > 500) buf = buf.substring(250);
      }
      if (buf.indexOf("ready") >= 0) break;
    }
    while (Serial2.available()) Serial2.read();

    WiFi.init(Serial2);
    basarisizSayaci = 0;
  }

  // WiFi bağlantısı kontrol et
  if (WiFi.status() != WL_CONNECTED) {
    Serial.print("WiFi yeniden baglaniliyor...");
    WiFi.disconnect();
    delay(500);
    WiFi.begin(ssid, pass);
    unsigned long t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
      delay(500);
      Serial.print(".");
    }
    Serial.println();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi baglantisi kurulamadi, tekrar denenecek.");
      basarisizSayaci++;
      return;
    }
    Serial.print("WiFi baglandi! IP: ");
    Serial.println(WiFi.localIP());
  }

  // WebSocket bağlantısını dene
  client.stop();
  delay(500);
  if (!wsConnect()) {
    basarisizSayaci++;
    Serial.print("Basarisiz deneme: ");
    Serial.print(basarisizSayaci);
    Serial.println("/3");
    delay(3000);
  } else {
    basarisizSayaci = 0;
  }
}

// Gelen WebSocket frame'lerini işler, ping gelirse pong döner
void wsHandleIncoming() {
  if (!client.available()) return;

  // Frame header: byte 0 = FIN+opcode, byte 1 = uzunluk
  uint8_t b0 = client.read();
  if (!client.available()) return;
  uint8_t b1 = client.read();

  uint8_t opcode = b0 & 0x0F;
  uint8_t masked = (b1 & 0x80) >> 7;
  uint64_t payloadLen = b1 & 0x7F;

  if (payloadLen == 126) {
    uint8_t ext[2];
    client.readBytes(ext, 2);
    payloadLen = ((uint16_t)ext[0] << 8) | ext[1];
  } else if (payloadLen == 127) {
    // 64-bit uzunluk — bu boyutta ping gelmez, atla
    return;
  }

  uint8_t mask[4] = {0};
  if (masked) client.readBytes(mask, 4);

  // Payload oku (ping için max 125 byte)
  uint8_t payload[125];
  uint8_t readLen = (uint8_t)min((uint64_t)125, payloadLen);
  for (uint8_t i = 0; i < readLen; i++) {
    uint8_t raw = client.available() ? client.read() : 0;
    payload[i] = masked ? (raw ^ mask[i % 4]) : raw;
  }

  if (opcode == 0x9) {
    // Ping alindi, maskeli Pong gonder (RFC 6455: client->server maskelenmeli)
    uint8_t pongMask[4] = {0x4A, 0xC3, 0x7E, 0x21};
    client.write((uint8_t)0x8A);                   // FIN + pong opcode
    client.write((uint8_t)(0x80 | readLen));       // MASK=1 + uzunluk
    client.write(pongMask, 4);
    for (uint8_t i = 0; i < readLen; i++) {
      client.write((uint8_t)(payload[i] ^ pongMask[i % 4]));
    }
  }
  // opcode 0x8 = connection close — baglanti kopacak, loop halleder
}


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
    Serial.println("WebSocket yeniden deneniyor (3sn)...");
    delay(3000);
  }

  Serial.println("-----------------------------------------");
}

// ── Loop ─────────────────────────────────────────────────────────

void loop() {
  // Gelen tüm frame'leri işle (ping → pong)
  while (client.available() >= 2) wsHandleIncoming();

  // CCS811 oku
  if (ccs.available() && !ccs.readData()) {
    co2  = ccs.geteCO2();
    voc  = ccs.getTVOC();
    ccsOk = true;
  }

  // PMS5003 oku
  if (pms.readUntil(data, 20)) {
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
      tamYenidenBaglan();
      return; // Bu turda gönderme yapma, sonraki iterasyonda devam et
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
