import { settings } from "../config";
import type { Store } from "../db/store";
import { logger } from "../server/logger";
import { canonicalPageUrl } from "../server/preview-fetch";
import { revalidatePage } from "../server/page-observe";
import type { Source } from "../types";
import {
  isContextDependent,
  questionKey,
  searchDecision,
  type CheckedPage,
} from "./search-cache";

function sourceUrls(sources: Source[]) {
  return [
    ...new Set(
      sources
        .map((source) => canonicalPageUrl(source.url))
        .filter((url): url is string => Boolean(url)),
    ),
  ].slice(0, 3);
}
export async function prepareSearchRefresh(args: {
  store: Store;
  owner: string;
  conversationId: string;
  question: string;
  forceSearch: boolean;
  recheck: boolean;
  signal: AbortSignal;
}) {
  const empty = { reuse: false, note: "", detail: "", sources: [] as Source[] };
  if (
    !settings.searchReuse ||
    args.forceSearch ||
    args.signal.aborted ||
    isContextDependent(args.question)
  )
    return empty;
  try {
    const lookup = args.store.searchLookup(
      args.owner,
      questionKey(args.question, args.conversationId),
    );
    if (!lookup) return empty;
    const budget = AbortSignal.any([
      args.signal,
      AbortSignal.timeout(settings.searchRevalidateMs),
    ]);
    const pages: CheckedPage[] = await Promise.all(
      lookup.urls.map(async (url) => {
        const previous = args.store.pageObservation(url);
        const result = await revalidatePage(url, previous, budget);
        return {
          url,
          state: result.state,
          title: result.page?.title || previous?.title || "",
          excerpt: result.page?.excerpt || "",
          previousExcerpt: previous?.excerpt || "",
        };
      }),
    );
    const decision = searchDecision({
      question: args.question,
      forceSearch: args.forceSearch,
      recheck: args.recheck,
      savedAt: lookup.savedAt,
      now: Date.now(),
      pages,
    });
    logger.info(
      {
        component: "search-cache",
        reuse: decision.reuse,
        pages: pages.length,
        changed: pages.filter((page) => page.state === "changed").length,
      },
      "revalidated saved sources",
    );
    return {
      ...decision,
      sources: decision.reuse
        ? pages
            .filter((page) => page.state === "unchanged")
            .map((page) => ({ url: page.url, title: page.title || page.url }))
        : [],
    };
  } catch (error) {
    logger.warn(
      { component: "search-cache", err: error },
      "search revalidation skipped",
    );
    return empty;
  }
}
export async function rememberSearch(
  store: Store,
  owner: string,
  conversationId: string,
  question: string,
  sources: Source[],
  options: { touchLookup: boolean },
) {
  const urls = sourceUrls(sources);
  if (!urls.length) return;
  const signal = AbortSignal.timeout(8000);
  await Promise.all(
    urls.map(async (url) => {
      const previous = store.pageObservation(url);
      const result = await revalidatePage(url, previous, signal);
      if (!result.page) return;
      const title = sources.find(
        (source) => canonicalPageUrl(source.url) === url,
      )?.title;
      store.savePageObservation({
        ...result.page,
        title: title?.slice(0, 180) || result.page.title,
      });
    }),
  );
  if (options.touchLookup)
    store.saveSearchLookup(
      owner,
      questionKey(question, conversationId),
      urls,
      new Date().toISOString(),
    );
}
