import { LlmContent } from '../services/providers/llm/ILlmProvider';

/**
 * Extract text content from LlmContent array
 */
export function extractTextFromContent(content: LlmContent[]): string {
  return content
    .filter(block => block.contentType === 'text')
    .map(block => (block as any).text)
    .join('');
}

/**
 * Calculate total content size for logging
 */
export function getContentSize(content: LlmContent[]): number {
  let size = 0;
  for (const block of content) {
    if (block.contentType === 'text') {
      size += (block as any).text.length;
    } else if (block.contentType === 'image' || block.contentType === 'audio') {
      size += (block as any).data.length;
    }
  }
  return size;
}
