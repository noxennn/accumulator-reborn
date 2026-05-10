import { useEffect, useRef, useState } from 'react';
import useSound from 'use-sound';

const alertSound = '/alert.mp3';

export const useAlerts = (
  value: number,
  threshold: number,
  type: 'co2' | 'pm25' | 'pm10' | 'voc'
) => {
  const [play] = useSound(alertSound);
  const [alerts, setAlerts] = useState<string[]>([]);
  const wasAboveThresholdRef = useRef(false);

  const metricLabel = type === 'co2' ? 'CO₂' : type.toUpperCase();

  useEffect(() => {
    if (value > threshold) {
      if (!wasAboveThresholdRef.current) {
        play();
      }
      setAlerts([`${metricLabel} seviyesi eşik değerini aştı: ${value}`]);
      wasAboveThresholdRef.current = true;
    } else {
      setAlerts([]);
      wasAboveThresholdRef.current = false;
    }
  }, [value, threshold, metricLabel, play]);

  return alerts;
};