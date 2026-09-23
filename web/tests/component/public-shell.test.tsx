// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PublicShell } from "@/components/layout/public-shell";

afterEach(() => {
  cleanup();
});

describe("PublicShell", () => {
  it("renders public landmarks around the route content", () => {
    render(
      <PublicShell>
        <p>Маршрутный контент</p>
      </PublicShell>,
    );

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByText("Маршрутный контент")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /tuttoseriea\.com/i }).getAttribute("href"),
    ).toBe("/");
  });
});
