// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClubsList } from "@/components/football/clubs-list";

afterEach(() => {
  cleanup();
});

describe("ClubsList", () => {
  it("renders an empty state before the first sync", () => {
    render(<ClubsList clubs={[]} />);

    expect(
      screen.getByText("Клубы появятся после первой синхронизации данных API-Football."),
    ).toBeTruthy();
  });

  it("renders resolved club names and localized geography", () => {
    render(
      <ClubsList
        clubs={[
          {
            id: "club-1",
            slug: "milan-manual",
            displayName: "Милан",
            providerName: "AC Milan",
            nameRu: "Милан",
            code: "MIL",
            country: "Italy",
            providerLogoUrl: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Милан")).toBeTruthy();
    expect(screen.getByText("MIL · Италия")).toBeTruthy();
  });
});
