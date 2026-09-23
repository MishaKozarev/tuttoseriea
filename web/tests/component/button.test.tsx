// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"

afterEach(() => {
  cleanup()
})

describe("Button", () => {
  it("renders the Base UI button primitive", () => {
    render(<Button>Continue</Button>)

    const button = screen.getByRole("button", { name: "Continue" })

    expect(button).toBeTruthy()
    expect(button.dataset.slot).toBe("button")
    expect(button.className).toContain("bg-primary")
  })
})
