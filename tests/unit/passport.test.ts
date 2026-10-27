import { describe, expect, it } from "vitest";
import { dogAge, formatSex, formatWeight, hasEmergency, hasHealth, shareLinkState, telHref } from "@/domain/passport";

describe("dogAge", () => {
  it("counts full months, then full years", () => {
    expect(dogAge("2023-03-15", "2026-03-14")).toBe("2 ans");
    expect(dogAge("2023-03-15", "2026-03-15")).toBe("3 ans");
    expect(dogAge("2025-03-15", "2026-03-15")).toBe("1 an");
    expect(dogAge("2026-01-31", "2026-10-28")).toBe("8 mois");
    expect(dogAge("2026-10-10", "2026-10-28")).toBe("moins d'un mois");
  });

  it("returns null without a date or for a future date", () => {
    expect(dogAge(null, "2026-10-28")).toBeNull();
    expect(dogAge("2027-01-01", "2026-10-28")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats weight with a French decimal comma", () => {
    expect(formatWeight("12.5")).toBe("12,5 kg");
    expect(formatWeight(30)).toBe("30 kg");
    expect(formatWeight(null)).toBeNull();
    expect(formatWeight("0")).toBeNull();
  });

  it("agrees sex and sterilization", () => {
    expect(formatSex("male", true)).toBe("Mâle, stérilisé");
    expect(formatSex("female", false)).toBe("Femelle, non stérilisée");
    expect(formatSex("female", null)).toBe("Femelle");
    expect(formatSex(null, true)).toBe("Stérilisé");
    expect(formatSex(null, null)).toBeNull();
  });

  it("builds a dialable tel: link", () => {
    expect(telHref("06 12 34 56 78")).toBe("tel:0612345678");
    expect(telHref("+33 (0)6 12-34.56.78")).toBe("tel:+33612345678");
  });
});

describe("sections and links", () => {
  it("detects empty health and emergency sections", () => {
    expect(hasHealth(null)).toBe(false);
    expect(
      hasHealth({ allergies: null, treatments: null, vet_name: null, vet_clinic: null, vet_phone: null, vet_address: null, notes: null }),
    ).toBe(false);
    expect(hasHealth({ allergies: "Poulet", treatments: null, vet_name: null, vet_clinic: null, vet_phone: null, vet_address: null, notes: null })).toBe(true);
    expect(hasEmergency({ contacts: [], instructions: null })).toBe(false);
    expect(hasEmergency({ contacts: [{ name: "A", phone: "0612" }], instructions: null })).toBe(true);
  });

  it("derives a share link state", () => {
    const now = new Date("2026-10-28T10:00:00Z");
    expect(shareLinkState({ expires_at: "2026-10-29T10:00:00Z", revoked_at: null }, now)).toBe("active");
    expect(shareLinkState({ expires_at: "2026-10-28T09:59:00Z", revoked_at: null }, now)).toBe("expired");
    expect(shareLinkState({ expires_at: "2026-10-29T10:00:00Z", revoked_at: "2026-10-28T09:00:00Z" }, now)).toBe("revoked");
  });
});
