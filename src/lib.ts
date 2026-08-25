import ora from "ora";

export async function runWithSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  options: { indent?: number } = {}
): Promise<T> {
  const spinner = ora({ text, indent: options.indent }).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
