import { prisma } from "../../prisma.js";
import { CONVERSION_MATRIX } from "@filehub/shared";

const DISABLED_CONVERSIONS_KEY = "disabledConversions"; // JSON string[] of "category:format"

export async function getDisabledConversions(): Promise<string[]> {
  const row = await prisma.settings.findUnique({ where: { key: DISABLED_CONVERSIONS_KEY } });
  return row ? JSON.parse(row.value) : [];
}

export async function setDisabledConversions(pairs: string[]): Promise<void> {
  await prisma.settings.upsert({
    where: { key: DISABLED_CONVERSIONS_KEY },
    update: { value: JSON.stringify(pairs) },
    create: { key: DISABLED_CONVERSIONS_KEY, value: JSON.stringify(pairs) },
  });
}

export async function getEffectiveConversionMatrix(): Promise<Record<string, string[]>> {
  const disabled = new Set(await getDisabledConversions());
  const effective: Record<string, string[]> = {};
  for (const [category, formats] of Object.entries(CONVERSION_MATRIX)) {
    effective[category] = formats.filter((f) => !disabled.has(`${category}:${f}`));
  }
  return effective;
}
