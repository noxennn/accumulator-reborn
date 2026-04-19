import { useEffect, useState } from 'react';
import useSound from 'use-sound';

const alertSound = '/alert.mp3';

export const useAlerts = (
  value: number,
  threshold: number,
  type: 'co2' | 'pm25' | 'pm10' | 'voc'
) => {
  const [play] = useSound(alertSound);
  const [alerts, setAlerts] = useState<string[]>([]);

  useEffect(() => {
    if (value > threshold) {
      play();
      // Görsel bildirim göster
      new Notification(`${type.toUpperCase()} Alert`, {
        body: `${type.toUpperCase()} level has exceeded the threshold: ${value}`,
        icon: '/warning.png'
      });
      
      // Uyarı mesajını ekle
      setAlerts(prev => [...prev, `${type.toUpperCase()} seviyesi eşik değerini aştı: ${value}`]);
    } else {
      // Eşik değeri altındaysa, bu tür uyarıyı kaldır
      setAlerts(prev => prev.filter(alert => !alert.includes(type.toUpperCase())));
    }
  }, [value, threshold, type, play]);

  return alerts;
};