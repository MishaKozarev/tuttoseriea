// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
  }: {
    alt: string;
    src: { src: string } | string;
  }) => {
    const imageSource = typeof src === "string" ? src : src.src;

    return createElement("img", { alt, src: imageSource });
  },
}));

afterEach(() => {
  cleanup();
});

describe("Home page", () => {
  it("renders the bootstrap marker", () => {
    render(<Home />);

    expect(screen.getByText("Bootstrap E2E marker")).toBeTruthy();
  });
});
