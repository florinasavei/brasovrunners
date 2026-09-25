import { describe, expect, it } from "vitest";
import { type HourlyForecast, parseOpenMeteo, pickHours, WEATHER_BLOCK_HOURS, WEATHER_FORECAST_DAYS } from "@/modules/weather/domain/forecast";
import {
  coordinatesInMapLink,
  coordinatesText,
  forecastPlace,
  PLACE_DECIMALS,
  parseTypedCoordinates,
  roundPlace,
  typedCoordinates,
} from "@/modules/weather/domain/place";
import { placeKey, placesReadWithinHour, readForecast } from "@/modules/weather/source";
import { forecastPlaceWords, weatherListWords, weatherWords } from "@/modules/weather/words";
import { eventFieldsSchema } from "@/modules/content/events/fields";

/**
 * §NNN (amending §402) — the forecast at the event's own place, and more of it: the place resolver's
 * order (the map link's pin, the typed «Coordonate», the club), the short link that is never
 * followed, the rounding that is the cache's key, the page's details and its three hours, and their
 * words in both languages. No socket: every request goes through a `fetch` handed in.
 */

const CLUB = { latitude: 45.6427, longitude: 25.5887 };
const HOUR = 60 * 60 * 1000;

describe("§NNN the coordinates a map link carries in its own address", () => {
  it("reads Google's `?q=` and `?query=`, a pin, a search path and the map's centre", () => {
    expect(coordinatesInMapLink("https://maps.google.com/?q=45.64,25.58")).toEqual({ latitude: 45.64, longitude: 25.58 });
    expect(coordinatesInMapLink("https://www.google.com/maps/search/?api=1&query=45.6384%2C25.5921")).toEqual({ latitude: 45.6384, longitude: 25.5921 });
    expect(coordinatesInMapLink("https://www.google.com/maps/@45.64,25.58,15z")).toEqual({ latitude: 45.64, longitude: 25.58 });
    expect(coordinatesInMapLink("https://www.google.com/maps/search/45.6384,+25.5921")).toEqual({ latitude: 45.6384, longitude: 25.5921 });
    // A place link: the dropped pin (`!3d…!4d…`) wins over the view it was opened at.
    expect(
      coordinatesInMapLink("https://www.google.com/maps/place/Tampa/@45.63,25.58,14z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d45.6384!4d25.5921"),
    ).toEqual({ latitude: 45.6384, longitude: 25.5921 });
  });

  it("reads OpenStreetMap's marker and its view, and a negative pair", () => {
    expect(coordinatesInMapLink("https://www.openstreetmap.org/?mlat=45.6384&mlon=25.5921#map=17/45.6/25.5")).toEqual({ latitude: 45.6384, longitude: 25.5921 });
    expect(coordinatesInMapLink("https://www.openstreetmap.org/#map=17/45.6384/25.5921")).toEqual({ latitude: 45.6384, longitude: 25.5921 });
    expect(coordinatesInMapLink("https://maps.google.com/?q=-33.86,151.21")).toEqual({ latitude: -33.86, longitude: 151.21 });
  });

  it("reads nothing from a short link — never followed — a venue's page, a place name, or a pair out of range", () => {
    expect(coordinatesInMapLink("https://maps.app.goo.gl/AbCdEf123")).toBeNull();
    expect(coordinatesInMapLink("https://goo.gl/maps/AbCdEf123")).toBeNull();
    expect(coordinatesInMapLink("https://www.example.org/venue/stadion")).toBeNull();
    expect(coordinatesInMapLink("https://maps.google.com/?q=Parcul+Tractorul")).toBeNull();
    expect(coordinatesInMapLink("https://maps.google.com/?q=95.1,25.5")).toBeNull();
    expect(coordinatesInMapLink("not a link")).toBeNull();
    expect(coordinatesInMapLink(null)).toBeNull();
    expect(coordinatesInMapLink("")).toBeNull();
  });
});

describe("§NNN where an event's forecast is asked for, in order", () => {
  const pin = "https://maps.google.com/?q=45.61,25.61";

  it("1. the map link's pin, over a typed pair", () => {
    expect(forecastPlace({ mapUrl: pin, latitude: 45.5, longitude: 25.5 }, CLUB)).toEqual({ coordinates: { latitude: 45.61, longitude: 25.61 }, source: "map" });
  });

  it("2. the typed «Coordonate» when the link carries none — a short link falls through to them", () => {
    expect(forecastPlace({ mapUrl: "https://maps.app.goo.gl/AbCdEf123", latitude: 45.5, longitude: 25.5 }, CLUB)).toEqual({
      coordinates: { latitude: 45.5, longitude: 25.5 },
      source: "typed",
    });
    expect(forecastPlace({ mapUrl: null, latitude: 45.5, longitude: 25.5 }, CLUB).source).toBe("typed");
  });

  it("3. the club's place when neither says one — a short link and no pair included", () => {
    expect(forecastPlace({ mapUrl: "https://maps.app.goo.gl/AbCdEf123" }, CLUB)).toEqual({ coordinates: CLUB, source: "club" });
    expect(forecastPlace({}, CLUB)).toEqual({ coordinates: CLUB, source: "club" });
    // Half a pair is no pair.
    expect(forecastPlace({ latitude: 45.5, longitude: null }, CLUB).source).toBe("club");
  });

  it("the club's place while the place is to be announced (§328), whatever the row holds", () => {
    expect(forecastPlace({ locationToBeAnnounced: true, mapUrl: pin, latitude: 45.5, longitude: 25.5 }, CLUB)).toEqual({ coordinates: CLUB, source: "club" });
  });

  it("reads a pair that arrives as text from a raw expression", () => {
    expect(typedCoordinates({ latitude: "45.5" as unknown as number, longitude: "25.5" as unknown as number })).toEqual({ latitude: 45.5, longitude: 25.5 });
  });
});

describe("§NNN the editor's «Coordonate» box", () => {
  it("takes what a map's «copy coordinates» gives, and the Romanian decimal comma", () => {
    expect(parseTypedCoordinates("45.6427, 25.5887")).toEqual({ latitude: 45.6427, longitude: 25.5887 });
    expect(parseTypedCoordinates("45.6427,25.5887")).toEqual({ latitude: 45.6427, longitude: 25.5887 });
    expect(parseTypedCoordinates("  45.6427 25.5887 ")).toEqual({ latitude: 45.6427, longitude: 25.5887 });
    expect(parseTypedCoordinates("45,6427; 25,5887")).toEqual({ latitude: 45.6427, longitude: 25.5887 });
    expect(parseTypedCoordinates("45,6427 25,5887")).toEqual({ latitude: 45.6427, longitude: 25.5887 });
  });

  it("is none when empty, and refuses one number, three, words or a pair out of range", () => {
    expect(parseTypedCoordinates("")).toBeNull();
    expect(parseTypedCoordinates("   ")).toBeNull();
    for (const bad of ["45.6427", "45.6, 25.5, 3", "Brașov", "91, 25", "45, 181", "45.6427, abc"]) {
      expect(parseTypedCoordinates(bad), bad).toBeUndefined();
    }
  });

  it("shows a stored pair as it takes it back", () => {
    const text = coordinatesText({ latitude: 45.6384, longitude: 25.5921 });
    expect(text).toBe("45.6384, 25.5921");
    expect(parseTypedCoordinates(text)).toEqual({ latitude: 45.6384, longitude: 25.5921 });
  });

  it("is refused at save naming the box, cleared by an empty box, and untouched when not posted", () => {
    const shape = eventFieldsSchema.shape.coordinates;
    expect(shape.safeParse("45.6384, 25.5921").data).toEqual({ latitude: 45.6384, longitude: 25.5921 });
    expect(shape.safeParse("").data).toBeNull();
    expect(shape.safeParse(undefined).data).toBeUndefined();
    const refused = shape.safeParse("45.6384");
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0].message).toMatch(/latitude and a longitude/);
  });
});

describe("§NNN one cached forecast per rounded place", () => {
  it("rounds to three decimals, about a hundred metres, and never keeps a -0", () => {
    expect(PLACE_DECIMALS).toBe(3);
    expect(roundPlace({ latitude: 45.64271, longitude: 25.58869 })).toEqual({ latitude: 45.643, longitude: 25.589 });
    expect(Object.is(roundPlace({ latitude: -0.0001, longitude: 0 }).latitude, 0)).toBe(true);
  });

  it("keys two pins in one car park alike and a trailhead across town apart", () => {
    expect(placeKey({ latitude: 45.63841, longitude: 25.59209 })).toBe(placeKey({ latitude: 45.6384, longitude: 25.5921 }));
    expect(placeKey({ latitude: 45.6384, longitude: 25.5921 })).not.toBe(placeKey(CLUB));
    expect(placeKey(CLUB)).toBe("45.643,25.589");
  });

  it("asks Open-Meteo for the rounded place, and counts the places read in the hour", async () => {
    // A clock of its own, so the count is this test's places alone.
    const now = new Date("2100-01-01T00:00:00Z").getTime();
    const asked: string[] = [];
    const answer = (url: string) => {
      asked.push(url);
      const time = Array.from({ length: 3 }, (_, index) => now / 1000 + index * 3600);
      const column = time.map(() => 1);
      return new Response(JSON.stringify({ hourly: { time, temperature_2m: column, precipitation_probability: column, weather_code: column, wind_speed_10m: column } }));
    };
    const fetchImpl = (async (url: string) => answer(url)) as unknown as typeof fetch;
    await readForecast({ latitude: 45.63841, longitude: 25.59209 }, { fetch: fetchImpl, source: "open-meteo", now });
    await readForecast({ latitude: 45.6384, longitude: 25.5921 }, { fetch: fetchImpl, source: "open-meteo", now });
    await readForecast({ latitude: 45.5, longitude: 25.3 }, { fetch: fetchImpl, source: "open-meteo", now });
    const first = new URL(asked[0]);
    expect(first.searchParams.get("latitude")).toBe("45.638");
    expect(first.searchParams.get("longitude")).toBe("25.592");
    expect(placesReadWithinHour(now)).toBe(2);
    // An hour and a minute on, neither is counted.
    expect(placesReadWithinHour(now + HOUR + 60_000)).toBe(0);
  });
});

describe("§NNN the start hour's details and the hours after it", () => {
  const START = new Date("2026-09-26T05:00:00Z");
  const first = new Date("2026-09-24T09:00:00Z").getTime();

  function answer(detail = true) {
    const time = Array.from({ length: WEATHER_FORECAST_DAYS * 24 }, (_, index) => (first + index * HOUR) / 1000);
    const at = (value: number) => time.map(() => value);
    return {
      hourly: {
        time,
        temperature_2m: time.map((_, index) => 10 + (index % 5)),
        precipitation_probability: at(40),
        weather_code: at(3),
        wind_speed_10m: at(12),
        ...(detail
          ? { apparent_temperature: at(8.6), precipitation: at(0.04), wind_gusts_10m: at(31.2), relative_humidity_2m: at(77), uv_index: at(0.2) }
          : {}),
      },
    };
  }

  it("carries the details for every hour, and none (not a failure) when an answer lacks them", () => {
    const withDetails = parseOpenMeteo(answer(), first) as HourlyForecast;
    expect(pickHours(withDetails, START)[0]).toMatchObject({ feelsLikeC: 8.6, precipitationMm: 0.04, gustKmh: 31.2, humidity: 77, uvIndex: 0.2 });
    const without = parseOpenMeteo(answer(false), first) as HourlyForecast;
    expect(pickHours(without, START)[0]).toMatchObject({ kind: "overcast", feelsLikeC: null, precipitationMm: null, gustKmh: null, humidity: null, uvIndex: null });
  });

  it("refuses a detail column that disagrees in length with the others, like any column", () => {
    const broken = answer();
    broken.hourly.wind_gusts_10m = [1, 2, 3];
    expect(parseOpenMeteo(broken, first)).toBeNull();
  });

  it("is the start's hour and the two after it, and leaves out an hour the answer lacks", () => {
    expect(WEATHER_BLOCK_HOURS).toBe(3);
    const hours = pickHours(parseOpenMeteo(answer(), first) as HourlyForecast, START);
    expect(hours.map((hour) => hour.hourAt)).toEqual([START.getTime(), START.getTime() + HOUR, START.getTime() + 2 * HOUR]);
    const lastHour = new Date(first + (WEATHER_FORECAST_DAYS * 24 - 2) * HOUR);
    expect(pickHours(parseOpenMeteo(answer(), first) as HourlyForecast, lastHour)).toHaveLength(2);
    expect(pickHours(parseOpenMeteo(answer(), first) as HourlyForecast, new Date(first + 30 * 24 * HOUR))).toEqual([]);
  });
});

describe("§NNN the details, in words, in both languages", () => {
  const reading = {
    hourAt: 0,
    code: 61,
    kind: "rain",
    glyph: "rain",
    temperatureC: 6.4,
    precipitationProbability: 80,
    windKmh: 17,
    feelsLikeC: 2.1,
    precipitationMm: 1.24,
    gustKmh: 38.4,
    humidity: 91,
    uvIndex: 2.6,
  } as const;

  it("says feels like, precipitation, gusts, humidity and UV in Romanian", () => {
    const words = weatherWords(reading, "ro");
    expect(words.extras).toEqual(["se simte ca 2 °C", "1,2 mm precipitații", "rafale 38 km/h", "umiditate 91%", "indice UV 3"]);
    expect(words.temperature).toBe("6 °C");
    expect(words.rainShort).toBe("80% ploaie");
  });

  it("and in English", () => {
    const words = weatherWords(reading, "en");
    expect(words.extras).toEqual(["feels like 2 °C", "1.2 mm of precipitation", "gusts 38 km/h", "humidity 91%", "UV index 3"]);
    expect(words.rainShort).toBe("80% rain");
  });

  it("leaves out rain under a tenth of a millimetre, a UV index that rounds to nothing, and what the hour lacks", () => {
    const words = weatherWords({ ...reading, precipitationMm: 0.04, uvIndex: 0.3, humidity: null, gustKmh: null }, "ro");
    expect(words.extras).toEqual(["se simte ca 2 °C"]);
    expect(weatherWords({ ...reading, temperatureC: null, precipitationProbability: null }, "en")).toMatchObject({ temperature: null, rainShort: null });
  });

  it("says which place the forecast is for, and names the block and the card's pill", () => {
    expect(forecastPlaceWords("map", "ro")).toBe("Pentru locul evenimentului");
    expect(forecastPlaceWords("typed", "en")).toBe("For the event's place");
    expect(forecastPlaceWords("club", "ro")).toBe("Pentru Brașov");
    expect(forecastPlaceWords("club", "en")).toBe("For Brașov");
    expect(weatherListWords("ro")).toEqual({ hours: "Pe ore, de la start", atStart: "Vremea la start", credit: "Prognoză: Open-Meteo" });
    expect(weatherListWords("en")).toEqual({ hours: "Hour by hour, from the start", atStart: "Weather at the start", credit: "Forecast: Open-Meteo" });
  });
});
