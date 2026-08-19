import { CloudRain, Sun, Cloud, CloudLightning, CloudSnow, CloudFog, CloudSun } from 'lucide-react';
export const directionToDegrees = {
    'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
    'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
    'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
    'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
};
export function getWindRotation(dirStr) {
    if (!dirStr)
        return 0;
    const normalized = dirStr.trim().toUpperCase();
    const degrees = directionToDegrees[normalized] !== undefined ? directionToDegrees[normalized] : 0;
    return (degrees + 180) % 360;
}
export function getHighestWindValue(windRange) {
    if (!windRange)
        return 0;
    const gustMatch = windRange.match(/gusts\s+(\d+)/i);
    if (gustMatch)
        return parseInt(gustMatch[1], 10);
    const numbers = windRange.match(/\d+/g);
    if (numbers && numbers.length > 0)
        return Math.max(...numbers.map(n => parseInt(n, 10)));
    return 0;
}
export function getWindColor(speed) {
    if (speed < 1)
        return '#94a3b8';
    if (speed < 5)
        return '#38bdf8';
    if (speed < 10)
        return '#22c55e';
    if (speed < 15)
        return '#eab308';
    if (speed < 20)
        return '#f97316';
    if (speed < 25)
        return '#ef4444';
    if (speed < 30)
        return '#d946ef';
    if (speed < 40)
        return '#a855f7';
    return '#4c1d95';
}
export function getWeatherIcon(reasonText, theme) {
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
export function formatSyncDateTime(timestamp) {
    if (!timestamp)
        return 'Awaiting Sync';
    const date = new Date(timestamp);
    const dateFormatted = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const timeFormatted = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    return `${dateFormatted} ${timeFormatted}`;
}
export function formatTempRangeString(tempRangeStr, targetUnit) {
    if (!tempRangeStr)
        return 'N/A';
    const regex = /(\d+)(?:\s*°?\s*([CF]))?/gi;
    return tempRangeStr.replace(regex, (_match, numStr, unit) => {
        const num = parseFloat(numStr);
        const sourceUnit = unit ? unit.toUpperCase() : 'F';
        if (sourceUnit === targetUnit) {
            return `${num}°${targetUnit}`;
        }
        let converted;
        if (sourceUnit === 'C' && targetUnit === 'F') {
            converted = Math.round(num * 9 / 5 + 32);
        }
        else if (sourceUnit === 'F' && targetUnit === 'C') {
            converted = Math.round((num - 32) * 5 / 9);
        }
        else {
            converted = num;
        }
        return `${converted}°${targetUnit}`;
    });
}
