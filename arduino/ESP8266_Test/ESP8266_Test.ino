// ESP8266 Baglanti ve AT Komut Test Kodu
// Diger bilesenlerin (CCS811, PMS5003) baginda bu kodu yukle

void bekleVeYazdir(unsigned long zaman_asimi_ms = 12000, unsigned long sessizlik_ms = 2000); // forward declaration
void rstVeBootBekle(); // forward declaration

void setup() {
  Serial.begin(9600);   // Serial Monitor
  Serial2.begin(115200);  // ESP8266 (TX2=pin16, RX2=pin17)

  Serial.println("=== ESP8266 Baglanti Testi ===");
  Serial.println("Serial2 (pin 16/17) uzerinden ESP8266 aranıyor...");
  Serial.println("");

  // --- Test 1: AT ---
  Serial.println(">> AT gonderiliyor...");
  Serial2.println("AT");
  bekleVeYazdir();

  // --- Test 2: AT+RST ---
  Serial.println(">> AT+RST gonderiliyor (reset)...");
  Serial2.println("AT+RST");
  rstVeBootBekle();

  // --- Test 3: AT (reset sonrasi) ---
  Serial.println(">> Reset sonrasi AT gonderiliyor...");
  Serial2.println("AT");
  bekleVeYazdir();

  // --- Test 4: Firmware versiyonu ---
  Serial.println(">> AT+GMR gonderiliyor (firmware versiyonu)...");
  Serial2.println("AT+GMR");
  bekleVeYazdir();

  // --- Test 5: Ag taramasi ---
  Serial.println(">> AT+CWMODE=1 gonderiliyor (station mode)...");
  Serial2.println("AT+CWMODE=1");
  bekleVeYazdir();

  Serial.println(">> AT+CWLAP gonderiliyor (ag listesi, ~15sn surabilir)...");
  Serial2.println("AT+CWLAP");
  bekleVeYazdir(20000, 8000);

  Serial.println("=== Test Tamamlandi ===");
  Serial.println("Yukaridaki sonuclara gore:");
  Serial.println("  - 'OK' gorunduyse ESP8266 calisiyor, kablo baglantisi dogru.");
  Serial.println("  - Hicbir yanit yoksa kablo baglantisini kontrol et.");
  Serial.println("  - AT+GMR ciktisinda 'AT version:1.7' veya usту gerekiyor.");
}

void loop() {
  // Serial Monitor'den ESP'ye komut gondermeye izin ver
  if (Serial.available()) {
    Serial2.write(Serial.read());
  }
  if (Serial2.available()) {
    Serial.write(Serial2.read());
  }
}

// AT+RST sonrasi "ready" gorene kadar bekler
void rstVeBootBekle() {
  String tampon = "";
  unsigned long baslangic = millis();
  while (millis() - baslangic < 8000) {
    while (Serial2.available()) {
      char c = Serial2.read();
      tampon += c;
      if (tampon.length() > 500) tampon = tampon.substring(250);
    }
    if (tampon.indexOf("ready") >= 0) break;
  }
  Serial.print("   Yanit: ");
  Serial.print(tampon);
  Serial.println();
  Serial.println("------");
  while (Serial2.available()) Serial2.read();
}

// OK/ERROR gorene kadar veya zaman asimina kadar okur
// Once tampon'a toplar, sonra yazdirir (115200->9600 baud farkinda veri kaybi onlenir)
void bekleVeYazdir(unsigned long zaman_asimi_ms, unsigned long sessizlik_ms) {
  String tampon = "";
  unsigned long son_veri = millis();
  bool veri_geldi = false;

  while (millis() - son_veri < zaman_asimi_ms) {
    while (Serial2.available()) {
      char c = Serial2.read();
      tampon += c;
      son_veri = millis();
      veri_geldi = true;
    }
    if (tampon.endsWith("OK\r\n") || tampon.endsWith("ERROR\r\n")) break;
    if (veri_geldi && millis() - son_veri > sessizlik_ms) break;
  }

  if (!veri_geldi) {
    Serial.println("   [YANIT YOK]");
  } else {
    Serial.print("   Yanit: ");
    Serial.print(tampon);
    Serial.println();
  }
  Serial.println("------");
}
