import { 
  CloudRain, 
  Sun,
  Cloud,
  CloudLightning,
  CloudSnow,
  CloudFog,
  CloudSun
} from 'lucide-react';

export const directionToDegrees: Record<string, number> = {
  'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
  'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
  'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
  'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
};

export function getWindRotation(dirStr: string | undefined): number {
  if (!dirStr) return 0;
  const normalized = dirStr.trim().toUpperCase();
  const degrees = directionToDegrees[normalized] !== undefined ? directionToDegrees[normalized] : 0;
  return (degrees + 180) % 360;
}

export function getHighestWindValue(windRange: string | undefined): number {
  if (!windRange) return 0;
  const gustMatch = windRange.match(/gusts\s+(\d+)/i);
  if (gustMatch) return parseInt(gustMatch[1], 10);
  const numbers = windRange.match(/\d+/g);
  if (numbers && numbers.length > 0) return Math.max(...numbers.map(n => parseInt(n, 10)));
  return 0;
}

/*
 * getWindColor lived here: a nine-step PredictWind-style ramp running through
 * fuchsia and violet. It has been removed rather than kept alongside the
 * fleet's scale, because keeping a second one alive under an older name is
 * exactly how there came to be four of them. Use windBandColor from
 * ./windScale, which every app now shares.
 */

export interface WeatherIconTheme {
  thunderstorm?: string;
  rain?: string;
  snow?: string;
  fog?: string;
  cloudySun?: string;
  sunny?: string;
  cloudy?: string;
  default?: string;
}

export function getWeatherIcon(reasonText: string | undefined, theme?: WeatherIconTheme) {
  const text = (reasonText || '').toLowerCase();
  if (text.includes('thunderstorm') || text.includes('lightning') || text.includes('squall')) {
    return { Icon: CloudLightning, color: theme?.thunderstorm || 'text-warning' };
  }
  if (text.includes('rain') || text.includes('shower') || text.includes('drizzle') || text.includes('wet')) {
    return { Icon: CloudRain, color: theme?.rain || 'text-cyan' };
  }
  if (text.includes('snow') || text.includes('sleet') || text.includes('ice') || text.includes('hail')) {
    return { Icon: CloudSnow, color: theme?.snow || 'text-cyan' };
  }
  if (text.includes('fog') || text.includes('mist') || text.includes('haze')) {
    return { Icon: CloudFog, color: theme?.fog || 'text-text-secondary' };
  }
  if (text.includes('mostly sunny') || text.includes('partly cloudy') || text.includes('partly sunny') || text.includes('mostly clear')) {
    return { Icon: CloudSun, color: theme?.cloudySun || 'text-warning' };
  }
  if (text.includes('sunny') || text.includes('clear') || text.includes('fair')) {
    return { Icon: Sun, color: theme?.sunny || 'text-warning' };
  }
  if (text.includes('cloudy') || text.includes('overcast')) {
    return { Icon: Cloud, color: theme?.cloudy || 'text-text-secondary' };
  }
  return { Icon: CloudRain, color: theme?.default || 'text-cyan' };
}

/**
 * When the forecast last landed, at the precision anyone reads it to.
 *
 * This used to render "Sep 11, 2026 12:41:49" under every forecast panel. The
 * date is almost always today and the seconds were never the question — the
 * question is "is this current", which a time answers. The date comes back only
 * once the reading is old enough for it to matter.
 */
export function formatSyncDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Awaiting sync';
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  const sameDay = new Date().toDateString() === date.toDateString();
  if (sameDay) return time;

  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} ${time}`;
}

/** What the forecast cards say for a value the forecast did not give. */
export const NOT_GIVEN = 'Not given';

/**
 * A forecast's temperature text ("18°C to 22°C", "-5°C to 3°C", "Low 28 to high 41°F")
 * in the unit the navigator chose.
 *
 * A minus sign belongs to its number. It used to be left behind by the pattern, so
 * -5°C was converted as 5°C and shown as "-41°F", sign kept and figure wrong, and a
 * forecast of frost read as a mild day. A hyphen between two numbers ("18-22°C") is
 * still a separator. A number with no unit of its own takes the unit the text uses
 * elsewhere, and Fahrenheit only when the text names none, which is what NWS sends.
 */
export function formatTempRangeString(tempRangeStr: string | undefined, targetUnit: string): string {
  if (!tempRangeStr) return NOT_GIVEN;
  const named = tempRangeStr.match(/\d\s*°?\s*([CF])\b/i);
  const defaultUnit = named ? named[1].toUpperCase() : 'F';
  const regex = /([-\u2212])?(\d+(?:\.\d+)?)(?:\s*°?\s*([CF])\b)?/gi;
  return tempRangeStr.replace(regex, (_match, sign, numStr, unit, offset: number, whole: string) => {
    // "18-22": the hyphen follows a number (or its unit), so it separates.
    const before = whole.slice(0, offset).trimEnd();
    const isMinus = Boolean(sign) && !/[\d°CF]$/i.test(before);
    const separator = sign && !isMinus ? sign : '';
    const num = parseFloat(numStr) * (isMinus ? -1 : 1);
    const sourceUnit = unit ? unit.toUpperCase() : defaultUnit;
    let converted;
    if (sourceUnit === 'C' && targetUnit === 'F') {
      converted = Math.round(num * 9/5 + 32);
    } else if (sourceUnit === 'F' && targetUnit === 'C') {
      converted = Math.round((num - 32) * 5/9);
    } else {
      converted = num;
    }
    // Math.round can give -0, which would print as "0" anyway; make it so.
    return `${separator}${converted === 0 ? 0 : converted}°${targetUnit}`;
  });
}
