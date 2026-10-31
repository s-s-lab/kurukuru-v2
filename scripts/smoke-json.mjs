export async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    // Response bodies may contain credentials, including partially received tokens.
    throw new Error(`Expected JSON (${response.status}): invalid JSON response.`);
  }
}
