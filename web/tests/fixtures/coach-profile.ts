// Synthetic provider data only; this is not a captured or live API response.
export function coachProfileFixture(id = 2914, name = "Fixture Coach") {
  return { id, name, firstname: "Fixture", lastname: "Coach", age: 66,
    birth: { date: "1960-01-01", place: "Fixture place", country: "Fixture country" },
    nationality: "Fixture nationality", height: "180 cm", weight: "75 kg", photo: "https://fixture.invalid/coach.png",
    team: { id: 496, name: "Fixture Team", logo: null },
    career: [
      { team: { id: 496, name: "Fixture Team", logo: null }, start: "2026-01-01", end: null },
      { team: { id: 489, name: "Other Fixture Team", logo: null }, start: "2025-01-01", end: null },
      { team: { id: 9999, name: "Historical Fixture Team", logo: null }, start: "2010-01-01", end: "2015-01-01" },
    ], extra: { fixture: true } };
}
