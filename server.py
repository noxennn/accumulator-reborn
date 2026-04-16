"""
Hava Kalitesi WebSocket Sunucusu
Arduino Mega + ESP8266'dan gelen CO2, VOC, PM2.5, PM10 verilerini alir.

Kurulum:
    pip install websockets

Calistirma:
    python server.py
"""

import asyncio
import websockets
import json
from datetime import datetime


async def handler(websocket):
    addr = websocket.remote_address
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Yeni baglanti: {addr}")
    try:
        async for message in websocket:
            ts = datetime.now().strftime('%H:%M:%S')
            try:
                data = json.loads(message)
                co2  = data.get("co2",  "?")
                voc  = data.get("voc",  "?")
                pm25 = data.get("pm25", "?")
                pm10 = data.get("pm10", "?")
                print(
                    f"[{ts}]  CO2: {co2} ppm  |  VOC: {voc} ppb  |"
                    f"  PM2.5: {pm25} ug/m3  |  PM10: {pm10} ug/m3"
                )
            except (json.JSONDecodeError, KeyError):
                # JSON degilse ham olarak yazdir
                print(f"[{ts}] Ham veri: {message}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Baglanti kesildi: {addr}")


async def main():
    host = "0.0.0.0"
    port = 8765
    print("=" * 55)
    print("  Hava Kalitesi WebSocket Sunucusu")
    print(f"  ws://{host}:{port}  uzerinde dinleniyor...")
    print("  Arduino'nun gondermesi gereken adres: 192.168.0.99:8765")
    print("=" * 55)
    async with websockets.serve(handler, host, port):
        await asyncio.Future()  # sonsuza kadar calis


if __name__ == "__main__":
    asyncio.run(main())
