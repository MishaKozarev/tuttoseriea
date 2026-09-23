// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Home from "@/app/(public)/page";

afterEach(() => {
  cleanup();
});

describe("Home page", () => {
  it("renders the public foundation heading", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Serie A на русском",
      }),
    ).toBeTruthy();
    expect(screen.getByText("tuttoseriea.com")).toBeTruthy();
  });
});
