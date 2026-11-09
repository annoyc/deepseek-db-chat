/**
 * The text a chunk is indexed and embedded under. The heading path is included so an
 * article about "注册" is still found by its section ("经营主体注册") and document title
 * even when the article omits them. Shared by the server index and the browser-side
 * search over uploaded documents.
 */
export function chunkSearchText(meta: { title: string }, chunk: { headings: string[]; label: string; text: string }): string {
  return [`《${meta.title}》`, ...chunk.headings, chunk.label].join(' ') + '\n' + chunk.text
}
