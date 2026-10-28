import { z } from "zod";
import { SLOT_KEYS } from "@/domain/config";

export const uuid = z.uuid({ message: "Identifiant invalide." });
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.");
export const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide.");

export const emailSchema = z.object({
  email: z.email({ message: "Adresse e-mail invalide." }).max(254),
});

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Indiquez votre prénom.")
  .max(40, "40 caractères maximum.");

export const groupNameSchema = z.string().trim().min(1, "Donnez un nom au groupe.").max(60, "60 caractères maximum.");

export const dogSchema = z.object({
  name: z.string().trim().min(1, "Indiquez le nom du chien.").max(40, "40 caractères maximum."),
  breed: z.string().trim().max(60, "60 caractères maximum.").optional().default(""),
  birthDate: z.union([localDate, z.literal("")]).optional().default(""),
  careNotes: z.string().trim().max(2000, "2000 caractères maximum.").optional().default(""),
});

const optionalText = (max: number) => z.string().trim().max(max, `${max} caractères maximum.`).optional().default("");
const phone = z
  .string()
  .trim()
  .regex(/^[0-9+() .-]{4,30}$/, "Numéro de téléphone invalide.");

export const dogIdentitySchema = z.object({
  name: dogSchema.shape.name,
  breed: dogSchema.shape.breed,
  birthDate: dogSchema.shape.birthDate,
  sex: z.enum(["female", "male", ""]).optional().default(""),
  sterilized: z.enum(["yes", "no", ""]).optional().default(""),
  weight: z
    .string()
    .trim()
    .regex(/^(\d{1,3}([.,]\d)?)?$/, "Poids invalide (par exemple 12,5).")
    .refine((w) => w === "" || (Number(w.replace(",", ".")) > 0 && Number(w.replace(",", ".")) < 150), "Poids invalide.")
    .optional()
    .default(""),
  identification: optionalText(30),
  distinctiveMarks: optionalText(300),
});

export const dogHabitsSchema = z.object({
  meals: optionalText(500),
  walks: optionalText(500),
  sleep: optionalText(500),
  behavior: optionalText(1000),
  careNotes: optionalText(2000),
});

export const dogHealthSchema = z.object({
  allergies: optionalText(500),
  treatments: optionalText(1000),
  vetName: optionalText(80),
  vetClinic: optionalText(80),
  vetPhone: z.union([phone, z.literal("")]).optional().default(""),
  vetAddress: optionalText(200),
  notes: optionalText(1000),
});

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(1, "Indiquez le nom du contact.").max(60, "60 caractères maximum."),
  relation: z.string().trim().max(40, "40 caractères maximum.").optional().default(""),
  phone,
});

export const dogEmergencySchema = z.object({
  contacts: z.array(emergencyContactSchema).max(5, "5 contacts maximum."),
  instructions: optionalText(1000),
});

const sectionAccess = z.enum(["always", "during_care", "never"]);
const isoInstant = z.iso.datetime({ offset: true, message: "Date invalide." });

export const circleMemberSchema = z.object({
  role: z.enum(["close", "entourage", "guest"]),
  health: sectionAccess,
  emergency: sectionAccess,
  startsAt: isoInstant.nullable(),
  endsAt: isoInstant.nullable(),
});

export const circleInviteSchema = z.object({
  role: z.enum(["close", "guest"]),
  health: z.enum(["always", "never"]),
  emergency: z.enum(["always", "never"]),
  startsAt: isoInstant.nullable(),
  endsAt: isoInstant.nullable(),
});

export const shareLinkSchema = z.object({
  hours: z.union([z.literal(24), z.literal(168), z.literal(720)]),
  health: z.boolean(),
  emergency: z.boolean(),
});

export const slotSchema = z.enum(SLOT_KEYS);

export const availabilityBatchSchema = z.object({
  cells: z
    .array(z.object({ date: localDate, slot: slotSchema }))
    .min(1, "Sélectionnez au moins un créneau.")
    .max(200, "Sélection trop grande."),
  status: z.enum(["available", "unavailable", "clear"]),
});

export const ruleSchema = z.object({
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Choisissez au moins un jour."),
  slots: z.array(slotSchema).min(1, "Choisissez au moins un créneau."),
  status: z.enum(["available", "unavailable", "clear"]),
});

export const requestTypeSchema = z.enum(["alone_info", "visit", "care", "partial_care"]);
export const necessitySchema = z.enum(["info", "nice_to_have", "required"]);

export const careRequestSchema = z
  .object({
    groupId: uuid,
    dogId: uuid,
    requestType: requestTypeSchema,
    necessity: necessitySchema,
    startDate: localDate,
    startTime: localTime,
    endDate: localDate,
    endTime: localTime,
    description: z.string().trim().max(1000, "1000 caractères maximum.").optional().default(""),
    splittable: z.boolean().default(true),
  })
  .refine((v) => v.requestType !== "alone_info" || v.necessity === "info", {
    message: "« Chien seul » est une simple information.",
    path: ["necessity"],
  });

export const responseSchema = z.object({
  requestId: uuid,
  status: z.enum(["yes", "no"]),
  proposedStart: z.iso.datetime({ offset: true }).nullable().optional(),
  proposedEnd: z.iso.datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(500).optional().default(""),
});
