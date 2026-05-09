# Plan: Canlı İzleme Geliştirmeleri

## Context
Kullanıcı canlı izleme (Watch) sayfasında 4 ayrı iyileştirme istiyor:
1. Buffer'ı 20→50'ye çıkar, sayfa açık kaldıkça veri birikmeye devam etsin (sınır yok)
2. Arduino'dan gelen ham log mesajları ve geçersiz (aralık dışı) veriler de WebSocket üzerinden frontende iletilsin, ayrı tablolarda gösterilsin
3. Grafik hover tooltip'leri Dashboard'daki gibi görünsün

---

## Değiştirilecek Dosyalar

1. `backend/main.py`
2. `frontend/src/hooks/useWebSocketData.ts`
3. `frontend/src/pages/Watch.tsx`
4. `frontend/src/i18n/locales/tr.json`
5. `frontend/src/i18n/locales/en.json`

---

## Detaylı Uygulama Adımları

### 1. `backend/main.py`

**a) ConnectionManager: Buffer boyutu ve yeni bufferlar**

```python
class ConnectionManager:
    def __init__(self):
        self.active_connections: set[WebSocket] = set()
        self.recent_data:    deque[dict] = deque(maxlen=50)  # 20→50
        self.recent_logs:    deque[dict] = deque(maxlen=50)  # YENİ
        self.recent_invalid: deque[dict] = deque(maxlen=50)  # YENİ
```

**b) `connect()`: Yeni client bağlandığında 3 buffer'ı da replay et**

Mevcut payload'a `"type": "data"` ekle. Bağlanınca şu sırayla gönder:
- `recent_data` → her öğeye `"type": "data"` zaten var (aşağıda)
- `recent_logs` → `"type": "log"`
- `recent_invalid` → `"type": "invalid"`

**c) `push_log()` ve `push_invalid()` metodları ekle**

**d) `/ws` endpoint: Tüm broadcast payload'larına `"type"` alanı ekle**

Geçerli veri payload'u:
```python
payload = {
    "type": "data",
    "timestamp": now_utc.isoformat(),
    "co2": co2, "voc": voc, "pm25": pm25, "pm10": pm10,
}
```

Geçersiz veri (aralık dışı) — her `continue` öncesine ekle:
```python
# Örnek: CO2 out of range
now_utc = datetime.now(timezone.utc)
reason = f"CO2 out of range ({co2}), expected 400-8192"
logger.warning(reason)
inv = {
    "type": "invalid",
    "timestamp": now_utc.isoformat(),
    "field": "co2",
    "value": co2,
    "reason": reason,
    "co2": co2, "voc": voc, "pm25": pm25, "pm10": pm10,
}
manager.recent_invalid.append(inv)
asyncio.create_task(manager.broadcast(inv))
continue
```
(VOC, PM2.5, PM10 için de aynı pattern; "incomplete data" durumu da `"field": "missing"` ile)

Ham log mesajı (`json.JSONDecodeError`):
```python
except json.JSONDecodeError:
    now_utc = datetime.now(timezone.utc)
    log_entry = {
        "type": "log",
        "timestamp": now_utc.isoformat(),
        "message": message,
    }
    logger.warning(f"Raw (non-JSON) data: {message}")
    manager.recent_logs.append(log_entry)
    asyncio.create_task(manager.broadcast(log_entry))
```

---

### 2. `frontend/src/hooks/useWebSocketData.ts`

**a) Yeni interface'ler:**
```ts
export interface LogEntry {
  type: 'log';
  timestamp: string;
  message: string;
}

export interface InvalidEntry {
  type: 'invalid';
  timestamp: string;
  field: string;
  value: number;
  reason: string;
  co2: number; voc: number; pm25: number; pm10: number;
}
```

**b) Yeni state:**
```ts
const [logsBuffer,    setLogsBuffer]    = useState<LogEntry[]>([]);
const [invalidBuffer, setInvalidBuffer] = useState<InvalidEntry[]>([]);
```

**c) `onmessage` routing:**
```ts
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'log') {
    setLogsBuffer(prev => [...prev, msg as LogEntry]);
  } else if (msg.type === 'invalid') {
    setInvalidBuffer(prev => [...prev, msg as InvalidEntry]);
  } else {
    // type === 'data' veya eski format (type yok)
    const point = msg as LiveDataPoint;
    if (seenTimestampsRef.current.has(point.timestamp)) return;
    seenTimestampsRef.current.add(point.timestamp);
    setDataBuffer(prev => {
      const updated = [...prev, point];
      if (updated.length <= MAX_RENDER_POINTS) return updated;
      const trimmed = updated.slice(-MAX_RENDER_POINTS);
      seenTimestampsRef.current = new Set(trimmed.map(p => p.timestamp));
      return trimmed;
    });
  }
};
```

**d) Return:**
```ts
return { dataBuffer, logsBuffer, invalidBuffer, isConnected, error };
```

Logs ve invalid için trim yok → sayfa açık kaldıkça birikir.

---

### 3. `frontend/src/pages/Watch.tsx`

**a) Data tablosu: `last10` → tüm birikmiş veri (ters sıra), max-height scroll**

`last10` yerine `allData = useMemo(() => dataBuffer.slice().reverse(), [dataBuffer])`.
Kart başlığını "Son 10 kayıt" → veri sayısını dinamik göster: `{allData.length} kayıt`.

**b) Chart tooltip'leri — Dashboard'daki gibi:**
```tsx
<Tooltip
  formatter={(v: number) => [
    typeof v === 'number' ? +v.toFixed(1) : v,
    `${label} (${unit})`
  ]}
  contentStyle={{
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    border: '1px solid #e5e7eb',
    borderRadius: '0.5rem',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    fontSize: 12,
  }}
  labelStyle={{ fontWeight: 600 }}
/>
```
Her grafik kendi `label` ve `unit`'ini bildiğinden `METRICS` map içindeki `{key, label, unit}` doğrudan kullanılacak.

**c) Logs ve Invalid tablolar — yeni bölüm (grafiklerin altına):**

İki kart yan yana (responsive: `grid-cols-1 md:grid-cols-2`), her biri max-height scroll:

- **Arduino Logları** tablosu: Saat | Mesaj
- **Geçersiz Veriler** tablosu: Saat | Alan | Değer | Neden (+ tooltip ile tam veri)

Timestamps `HH:mm:ss` formatında, monospace font.
En yeni kayıt üstte (`.slice().reverse()`).

**d) `useWebSocketData` hook'undan `logsBuffer`, `invalidBuffer` al.**

---

### 4. i18n Güncellemeleri

**tr.json — `watch` bloğuna ekle:**
```json
"allData": "Tüm Veriler",
"records": "kayıt",
"logs": "Arduino Logları",
"logsEmpty": "Log bekleniyor...",
"invalidData": "Geçersiz Veriler",
"invalidEmpty": "Geçersiz veri yok",
"field": "Alan",
"value": "Değer",
"reason": "Neden",
"message": "Mesaj"
```

**en.json — `watch` bloğuna ekle:**
```json
"allData": "All Data",
"records": "records",
"logs": "Arduino Logs",
"logsEmpty": "Waiting for logs...",
"invalidData": "Invalid Data",
"invalidEmpty": "No invalid data",
"field": "Field",
"value": "Value",
"reason": "Reason",
"message": "Message"
```

---

## Doğrulama

1. Backend başlat, Arduino bağlı değilken `/ws/live`'a bağlan → boş buffer alınmalı
2. Sayfa açıkken 50'den fazla veri gelmesini bekle → tablo büyümeye devam etmeli, sayfa yenilenince 50'ye dönmeli
3. Arduino'dan kasıtlı aralık dışı veri gönder → "Geçersiz Veriler" tablosunda görünmeli
4. Arduino'dan JSON olmayan log gönder → "Arduino Logları" tablosunda görünmeli
5. Her grafikte hover → Dashboard gibi stilize tooltip görünmeli (arka plan, border, shadow, değer+birim)
