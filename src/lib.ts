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
