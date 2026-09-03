/**
 * Live data sources — typed calls to APIs that return values which are wrong
 * the moment you cache them. This is what separates "retrieval over an index
 * built last month" from an agent that can answer about *now*.
 *
 * Every source here is keyless on its free tier, so live data works out of the
 * box with no configuration.
 */

const TIMEOUT = 12000;

async function getJson<T = any>(url: string, label: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Cortexa/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${label} returned ${res.status}`);
  return (await res.json()) as T;
}

const WMO: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "depositing rime fog", 51: "light drizzle", 53: "drizzle",
  55: "dense drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain", 71: "light snow", 73: "snow",
  75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers",
  82: "violent showers", 85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

export interface WeatherResult {
  place: string;
  country?: string;
  observed_at: string;
  temperature_c: number;
  feels_like_c: number;
  humidity_pct: number;
  wind_kmh: number;
  conditions: string;
  forecast: Array<{ date: string; min_c: number; max_c: number; conditions: string }>;
  fetched_at: string;
}

export async function getWeather(place: string): Promise<WeatherResult> {
  const geo = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`,
    "Geocoding"
  );
  const hit = geo?.results?.[0];
  if (!hit) throw new Error(`Could not find a place called "${place}"`);

  const w = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`,
    "Open-Meteo"
  );

  const c = w.current ?? {};
  const d = w.daily ?? {};
  return {
    place: hit.name,
    country: hit.country,
    observed_at: c.time,
    temperature_c: c.temperature_2m,
    feels_like_c: c.apparent_temperature,
    humidity_pct: c.relative_humidity_2m,
    wind_kmh: c.wind_speed_10m,
    conditions: WMO[c.weather_code] ?? `code ${c.weather_code}`,
    forecast: (d.time ?? []).map((date: string, i: number) => ({
      date,
      min_c: d.temperature_2m_min?.[i],
      max_c: d.temperature_2m_max?.[i],
      conditions: WMO[d.weather_code?.[i]] ?? "unknown",
    })),
    fetched_at: new Date().toISOString(),
  };
}

export interface RateResult {
  base: string;
  amount: number;
  rates: Record<string, number>;
  as_of: string;
  fetched_at: string;
}

export async function getExchangeRate(
  base: string,
  targets: string[],
  amount = 1
): Promise<RateResult> {
  const from = base.toUpperCase().slice(0, 3);
  const to = targets.map((t) => t.toUpperCase().slice(0, 3)).filter(Boolean);
  if (!to.length) throw new Error("At least one target currency is required");

  const json = await getJson(
    `https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to.join(",")}`,
    "Frankfurter"
  );
  if (!json?.rates || !Object.keys(json.rates).length)
    throw new Error(`No rates returned for ${from} → ${to.join(",")}`);

  return {
    base: json.base ?? from,
    amount: json.amount ?? amount,
    rates: json.rates,
    as_of: json.date,
    fetched_at: new Date().toISOString(),
  };
}

export interface CryptoResult {
  prices: Array<{
    id: string;
    price: number;
    currency: string;
    change_24h_pct: number | null;
    market_cap: number | null;
  }>;
  fetched_at: string;
}

/** CoinGecko ids, e.g. "bitcoin", "ethereum", "solana". */
export async function getCryptoPrice(
  ids: string[],
  currency = "usd"
): Promise<CryptoResult> {
  const list = ids.map((i) => i.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  if (!list.length) throw new Error("At least one coin id is required");
  const vs = currency.toLowerCase().slice(0, 6);

  const json = await getJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(list.join(","))}` +
      `&vs_currencies=${vs}&include_24hr_change=true&include_market_cap=true`,
    "CoinGecko"
  );

  const prices = list
    .filter((id) => json[id])
    .map((id) => ({
      id,
      price: json[id][vs],
      currency: vs.toUpperCase(),
      change_24h_pct:
        json[id][`${vs}_24h_change`] != null
          ? Number(Number(json[id][`${vs}_24h_change`]).toFixed(2))
          : null,
      market_cap: json[id][`${vs}_market_cap`] ?? null,
    }));

  if (!prices.length)
    throw new Error(
      `No prices found. Use CoinGecko ids like "bitcoin", "ethereum", not tickers like "BTC".`
    );

  return { prices, fetched_at: new Date().toISOString() };
}

export interface TimeResult {
  place: string;
  timezone: string;
  local_time: string;
  utc_offset_seconds: number;
  fetched_at: string;
}

export async function getCurrentTime(place: string): Promise<TimeResult> {
  const geo = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`,
    "Geocoding"
  );
  const hit = geo?.results?.[0];
  if (!hit) throw new Error(`Could not find a place called "${place}"`);

  const w = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m&timezone=auto`,
    "Open-Meteo"
  );

  return {
    place: `${hit.name}${hit.country ? `, ${hit.country}` : ""}`,
    timezone: w.timezone,
    local_time: w.current?.time,
    utc_offset_seconds: w.utc_offset_seconds,
    fetched_at: new Date().toISOString(),
  };
}
