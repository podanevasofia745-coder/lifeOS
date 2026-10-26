import { z } from "zod";
export const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Укажите имя")
    .max(80, "Не более 80 символов"),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("ru", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Неизвестный часовой пояс"),
  theme: z.enum(["light", "dark", "system"]),
  preferred_wake: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ"),
  preferred_bedtime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ"),
  target_sleep_minutes: z.number().int().min(240).max(720),
});
export type Profile = z.infer<typeof profileSchema> & { version: number };
export const defaultProfile: Profile = {
  display_name: "",
  timezone: "Europe/Moscow",
  theme: "system",
  preferred_wake: "07:00",
  preferred_bedtime: "23:00",
  target_sleep_minutes: 480,
  version: 1,
};
