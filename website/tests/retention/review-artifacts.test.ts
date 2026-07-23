// clearReviewArtifacts — recursive scope + verification, with a stub storage client.
// Privacy-load-bearing in CI: a top-level-only delete would leave a child's nested
// portraits behind, and a whole-prefix delete would take book.pdf with it. Both are
// asserted here so a future change can't silently regress either.
import { describe, it, expect } from 'vitest';
import { clearReviewArtifacts, reviewPrefix } from '@/lib/retention/review-artifacts';

/**
 * Stub Supabase storage backed by a flat set of object paths. list() emulates the real
 * (measured) non-recursive behaviour: it returns immediate files (id !== null) and
 * immediate subfolders (id === null) for a prefix, one level only.
 */
function stubClient(objects: string[]) {
  const store = new Set(objects);
  const removed: string[] = [];
  const listOneLevel = (prefix: string) => {
    const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const files = new Map<string, boolean>(); // name → isFile
    for (const path of store) {
      if (!path.startsWith(base)) continue;
      const rest = path.slice(base.length);
      const slash = rest.indexOf('/');
      if (slash === -1) files.set(rest, true); // immediate file
      else files.set(rest.slice(0, slash), false); // subfolder
    }
    return [...files.entries()].map(([name, isFile]) => ({ name, id: isFile ? 'file-id' : null }));
  };
  const client = {
    removed,
    remaining: () => [...store],
    storage: {
      from: () => ({
        list: async (prefix: string, _opts: unknown) => ({ data: listOneLevel(prefix), error: null }),
        remove: async (paths: string[]) => {
          for (const p of paths) {
            store.delete(p);
            removed.push(p);
          }
          return { error: null };
        },
      }),
    },
  };
  return client;
}

describe('clearReviewArtifacts', () => {
  const orderId = 'ORDER1';
  const nested = [
    `${reviewPrefix(orderId)}/story.json`,
    `${reviewPrefix(orderId)}/meta.json`,
    `${reviewPrefix(orderId)}/character-sheets/sheet-01.png`,
    `${reviewPrefix(orderId)}/character-sheets/protagonist-meta.json`,
    `${reviewPrefix(orderId)}/pages/page-01.pdf`,
    `${reviewPrefix(orderId)}/pages/page-01.png`,
    `${reviewPrefix(orderId)}/front-matter/00-cover.pdf`,
  ];
  const bookPdf = `orders/${orderId}/book.pdf`;

  it('recursively deletes every nested review object and preserves book.pdf', async () => {
    const client = stubClient([...nested, bookPdf]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await clearReviewArtifacts(orderId, { client: client as any });
    expect(res.deleted).toBe(nested.length);
    // Every review object removed, at every depth.
    for (const p of nested) expect(client.removed).toContain(p);
    // book.pdf is out of scope by construction (recursion starts at review/).
    expect(client.removed).not.toContain(bookPdf);
    expect(client.remaining()).toEqual([bookPdf]);
  });

  it('is an idempotent no-op when there is no review/ prefix', async () => {
    const client = stubClient([bookPdf]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await clearReviewArtifacts(orderId, { client: client as any });
    expect(res.deleted).toBe(0);
    expect(client.removed).toEqual([]);
    expect(client.remaining()).toEqual([bookPdf]);
  });

  it('throws if verification still lists an object after remove (never silently incomplete)', async () => {
    // A stub whose remove() is a no-op: the post-delete list still shows the objects.
    const stubborn = {
      storage: {
        from: () => ({
          list: async () => ({ data: [{ name: 'story.json', id: 'file-id' }], error: null }),
          remove: async () => ({ error: null }), // pretends success but changes nothing
        }),
      },
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clearReviewArtifacts(orderId, { client: stubborn as any }),
    ).rejects.toThrow(/cleanup incomplete/);
  });
});
