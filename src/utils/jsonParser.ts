/**
 * Remove markdown code fences from a string.
 * 
 * Handles strings in the following formats:
 * - Markdown code block: ```json\n{...}\n```
 * - Plain JSON string: {...}
 * 
 * @param input - The string to parse as JSON
 * @returns Plain JSON string without markdown code fences
 */
export function removeJsonMarkers(input: string): unknown {
  let jsonString = input.trim();

  // Check if the string starts with ```json and ends with ```
  const hasJsonCodeFence = jsonString.startsWith('```json');
  const hasClosingFence = jsonString.endsWith('```');

  if (hasJsonCodeFence && hasClosingFence) {
    // Extract content between the markers
    // Remove opening ```json and closing ```
    const lines = jsonString.split('\n');
    
    // Remove first line (```json) and last line (```)
    const contentLines = lines.slice(1, -1);
    jsonString = contentLines.join('\n').trim();
  } else if (jsonString.startsWith('```') && hasClosingFence) {
    // Handle generic code fence (```\n{...}\n```)
    const lines = jsonString.split('\n');
    const contentLines = lines.slice(1, -1);
    jsonString = contentLines.join('\n').trim();
  }

  // Clean JSON string
  return jsonString;
}

export function parseJsonFromMarkdown(input: string): unknown {
  const jsonString = removeJsonMarkers(input);
  return JSON.parse(jsonString as string);
} 